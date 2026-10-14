package inflight

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func resetRegistry(t *testing.T) {
	t.Helper()
	clear := func() {
		defaultRegistry.mu.Lock()
		defaultRegistry.inflight = make(map[string]*Record)
		defaultRegistry.counts = make(map[string]int)
		defaultRegistry.peaks = make(map[string]int)
		defaultRegistry.mu.Unlock()
	}
	clear()
	t.Cleanup(clear)
}

func newContext(requestId string) *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set(string(constant.ContextKeyUserName), "alice")
	c.Set("token_name", "primary")
	c.Set(string(constant.ContextKeyChannelId), 7)
	c.Set(string(constant.ContextKeyChannelName), "east")
	if requestId != "" {
		c.Set(common.RequestIdKey, requestId)
	}
	return c
}

func newRelayInfo(model string) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{OriginModelName: model}
}

func errorWithStatus(status int) *types.NewAPIError {
	return types.NewErrorWithStatusCode(errors.New("boom"), types.ErrorCodeInvalidRequest, status)
}

func TestBeginRegistersQueuedRecordWithRelayMetadata(t *testing.T) {
	resetRegistry(t)

	record := Begin(newContext("req-1"), newRelayInfo("gpt-4o"))

	require.NotNil(t, record)
	assert.Equal(t, "req-1", record.Id)
	assert.Equal(t, "gpt-4o", record.Model)
	assert.Equal(t, "alice", record.Username)
	assert.Equal(t, "primary", record.TokenName)
	assert.Equal(t, PhaseQueued, record.Phase)
	assert.Equal(t, 1, TakeSnapshot().TotalInflight)
}

func TestMarkActiveSwitchesPhaseAndFillsChannel(t *testing.T) {
	resetRegistry(t)

	info := newRelayInfo("gpt-4o")
	info.SetEstimatePromptTokens(2048)
	record := Begin(newContext("req-1"), info)
	MarkActive(record, newContext(""), info)

	assert.Equal(t, PhaseActive, record.Phase)
	assert.Equal(t, 7, record.ChannelId)
	assert.Equal(t, "east", record.ChannelName)
	// Begin 时还没有估算值，MarkActive 时补上
	assert.Equal(t, 2048, record.EstimatedPromptTokens)
}

func TestFinishRemovesRecordAndKeepsPeak(t *testing.T) {
	resetRegistry(t)

	first := Begin(newContext("req-1"), newRelayInfo("gpt-4o"))
	second := Begin(newContext("req-2"), newRelayInfo("gpt-4o"))
	require.Equal(t, 2, TakeSnapshot().Peaks["gpt-4o"])

	Finish(second, nil)
	Finish(first, nil)

	snapshot := TakeSnapshot()
	assert.Equal(t, 0, snapshot.TotalInflight)
	// 峰值只增不减：请求结束后仍保留历史最高水位
	assert.Equal(t, 2, snapshot.Peaks["gpt-4o"])
}

func TestFinishRaisesPeakOnUpstreamTooManyRequests(t *testing.T) {
	resetRegistry(t)

	record := Begin(newContext("req-1"), newRelayInfo("gpt-4o"))
	apiErr := errorWithStatus(http.StatusTooManyRequests)

	// 峰值取「撞 429 当时压在网关上的请求数」，含本次请求
	Finish(record, &apiErr)

	assert.Equal(t, 1, TakeSnapshot().Peaks["gpt-4o"])
	assert.Equal(t, 0, TakeSnapshot().TotalInflight)
}

func TestFinishIgnoresNonTooManyRequestsErrors(t *testing.T) {
	resetRegistry(t)

	record := Begin(newContext("req-1"), newRelayInfo("gpt-4o"))
	apiErr := errorWithStatus(http.StatusInternalServerError)

	Finish(record, &apiErr)

	// 错误本身不抬升峰值；这里的 1 来自 Begin 时记录到的并发
	assert.Equal(t, 1, TakeSnapshot().Peaks["gpt-4o"])
}

func TestPeakTracksObservedConcurrencyAndNeverDrops(t *testing.T) {
	resetRegistry(t)

	first := Begin(newContext("req-1"), newRelayInfo("gpt-4o"))
	second := Begin(newContext("req-2"), newRelayInfo("gpt-4o"))
	third := Begin(newContext("req-3"), newRelayInfo("gpt-4o"))
	require.Equal(t, 3, TakeSnapshot().Peaks["gpt-4o"])

	// 并发回落后峰值不降
	Finish(third, nil)
	assert.Equal(t, 3, TakeSnapshot().Peaks["gpt-4o"])

	// 并发再涨回来也不超过已记录的峰值
	Begin(newContext("req-4"), newRelayInfo("gpt-4o"))
	assert.Equal(t, 3, TakeSnapshot().Peaks["gpt-4o"])

	Finish(second, nil)
	Finish(first, nil)
}

func TestPeaksArePerModel(t *testing.T) {
	resetRegistry(t)

	claude := Begin(newContext("req-1"), newRelayInfo("claude"))
	Begin(newContext("req-2"), newRelayInfo("gpt-4o"))
	Begin(newContext("req-3"), newRelayInfo("gpt-4o"))

	peaks := TakeSnapshot().Peaks
	assert.Equal(t, 1, peaks["claude"])
	assert.Equal(t, 2, peaks["gpt-4o"])

	Finish(claude, nil)
	assert.Equal(t, 1, TakeSnapshot().Peaks["claude"])
}

func TestSnapshotAggregatesEstimatedTokens(t *testing.T) {
	resetRegistry(t)

	first := Begin(newContext("req-1"), newRelayInfo("gpt-4o"))
	first.EstimatedPromptTokens = 1200
	second := Begin(newContext("req-2"), newRelayInfo("claude"))
	second.EstimatedPromptTokens = 300

	snapshot := TakeSnapshot()
	assert.Equal(t, 2, snapshot.TotalInflight)
	assert.Equal(t, 1500, snapshot.TotalEstimatedTokens)
}

func TestBeginDropsRecordBeyondCapacity(t *testing.T) {
	resetRegistry(t)

	// 直接填满，绕开 5000 次 Begin 的开销
	defaultRegistry.mu.Lock()
	for i := range maxTrackedInflight {
		defaultRegistry.inflight[strconv.Itoa(i)] = &Record{Id: strconv.Itoa(i), Model: "gpt-4o"}
	}
	defaultRegistry.mu.Unlock()

	record := Begin(newContext("req-over"), newRelayInfo("gpt-4o"))
	require.NotNil(t, record)
	assert.Equal(t, maxTrackedInflight, TakeSnapshot().TotalInflight)

	// 未登记的记录上调用 MarkActive / Finish 不应 panic
	MarkActive(record, newContext(""), newRelayInfo("gpt-4o"))
	Finish(record, nil)
}

func TestNilAndUnregisteredRecordsAreSafe(t *testing.T) {
	resetRegistry(t)

	Begin(nil, newRelayInfo("gpt-4o"))
	Begin(newContext("req-1"), nil)

	apiErr := errorWithStatus(http.StatusTooManyRequests)
	Finish(nil, &apiErr)
	Finish(&Record{Id: "not-registered", Model: "gpt-4o"}, &apiErr)
	MarkActive(nil, nil, nil)

	assert.Equal(t, 0, TakeSnapshot().TotalInflight)
}

func TestConcurrentBeginFinishKeepsCountsConsistent(t *testing.T) {
	resetRegistry(t)

	var wg sync.WaitGroup
	for i := range 50 {
		wg.Go(func() {
			info := newRelayInfo("gpt-4o")
			record := Begin(newContext("req-"+strconv.Itoa(i)), info)
			MarkActive(record, newContext(""), info)
			Finish(record, nil)
		})
	}
	wg.Wait()

	snapshot := TakeSnapshot()
	assert.Equal(t, 0, snapshot.TotalInflight)
	assert.LessOrEqual(t, snapshot.Peaks["gpt-4o"], 50)
}
