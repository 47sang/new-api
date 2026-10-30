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

func TestFinishTightensPeakOnUpstreamTooManyRequests(t *testing.T) {
	resetRegistry(t)

	Begin(newContext("req-1"), newRelayInfo("gpt-4o"))
	second := Begin(newContext("req-2"), newRelayInfo("gpt-4o"))
	require.Equal(t, 2, TakeSnapshot().Peaks["gpt-4o"])

	apiErr := errorWithStatus(http.StatusTooManyRequests)
	// req-2 被上游拒掉，真正在跑的只剩 req-1，上限随之收紧到 1
	Finish(second, &apiErr)

	assert.Equal(t, 1, TakeSnapshot().Peaks["gpt-4o"])
	assert.Equal(t, 1, TakeSnapshot().TotalInflight)
}

// beginMany 连续登记 count 条同模型的在途请求，用于构造并发现场。
// prefix 保证各次调用拿到的请求 ID 不重复——在途表以 ID 为键，重号会互相顶掉。
func beginMany(t *testing.T, prefix, model string, count int) []*Record {
	t.Helper()
	records := make([]*Record, 0, count)
	for i := range count {
		records = append(records, Begin(newContext(prefix+"-"+strconv.Itoa(i)), newRelayInfo(model)))
	}
	return records
}

// 回归：上游并发上限是 8，第 9 条起被 429 拒掉。峰值必须收敛到 8，
// 不能被这些「注定被拒」的请求一路抬到 12 之后永久停住。
func TestPeakConvergesToUpstreamConcurrencyLimit(t *testing.T) {
	resetRegistry(t)

	beginMany(t, "served", "gpt-4o", 8)
	require.Equal(t, 8, TakeSnapshot().Peaks["gpt-4o"])

	apiErr := errorWithStatus(http.StatusTooManyRequests)
	for i := range 4 {
		rejected := Begin(newContext("req-rejected-"+strconv.Itoa(i)), newRelayInfo("gpt-4o")) // 被拒的请求从登记到结束一直计在途数里，峰值确实会被短暂抬高
		require.Greater(t, TakeSnapshot().Peaks["gpt-4o"], 8)
		Finish(rejected, &apiErr)
		// 但每条被拒都让上限回到「仍在被服务的 8 条」，不会越抬越高
		assert.Equal(t, 8, TakeSnapshot().Peaks["gpt-4o"])
	}

	assert.Equal(t, 8, TakeSnapshot().TotalInflight)
}

func TestPeakTightensWhenRejectedRequestsPileUp(t *testing.T) {
	resetRegistry(t)

	beginMany(t, "served", "gpt-4o", 8)
	rejected := beginMany(t, "rejected", "gpt-4o", 4)
	require.Equal(t, 12, TakeSnapshot().Peaks["gpt-4o"])

	apiErr := errorWithStatus(http.StatusTooManyRequests)
	// 4 条被拒请求同时在途：每结束一条上限收紧一格，最终收敛到真实上限 8
	for i, want := range []int{11, 10, 9, 8} {
		Finish(rejected[i], &apiErr)
		assert.Equal(t, want, TakeSnapshot().Peaks["gpt-4o"])
	}

	assert.Equal(t, 8, TakeSnapshot().TotalInflight)
}

func TestPeakRecoversAfterTightening(t *testing.T) {
	resetRegistry(t)

	beginMany(t, "served", "gpt-4o", 8)
	apiErr := errorWithStatus(http.StatusTooManyRequests)
	rejected := Begin(newContext("req-rejected"), newRelayInfo("gpt-4o"))
	Finish(rejected, &apiErr)
	require.Equal(t, 8, TakeSnapshot().Peaks["gpt-4o"])

	// 上游扩容后真的跑出更高并发且不再被拒：上限重新抬升，不被上次的收紧永久钉住
	beginMany(t, "extra", "gpt-4o", 12)
	assert.Equal(t, 20, TakeSnapshot().Peaks["gpt-4o"])
}

func TestPeakNeverTightensBelowOne(t *testing.T) {
	resetRegistry(t)

	record := Begin(newContext("req-1"), newRelayInfo("gpt-4o"))
	require.Equal(t, 1, TakeSnapshot().Peaks["gpt-4o"])

	apiErr := errorWithStatus(http.StatusTooManyRequests)
	Finish(record, &apiErr)

	// 单条请求被拒时没有「并发被打满」的证据，上限保留 1，该模型那一节也不会消失
	assert.Equal(t, 1, TakeSnapshot().Peaks["gpt-4o"])
	assert.Equal(t, 0, TakeSnapshot().TotalInflight)
}

func TestFinishIgnoresTooManyRequestsForUnregisteredRecord(t *testing.T) {
	resetRegistry(t)

	beginMany(t, "served", "gpt-4o", 8)
	require.Equal(t, 8, TakeSnapshot().Peaks["gpt-4o"])

	apiErr := errorWithStatus(http.StatusTooManyRequests)
	// 未登记的记录没有对应的在途数可减，不得据此收紧上限
	Finish(&Record{Id: "not-registered", Model: "gpt-4o"}, &apiErr)

	assert.Equal(t, 8, TakeSnapshot().Peaks["gpt-4o"])
	assert.Equal(t, 8, TakeSnapshot().TotalInflight)
}

func TestFinishIgnoresNonTooManyRequestsErrors(t *testing.T) {
	resetRegistry(t)

	record := Begin(newContext("req-1"), newRelayInfo("gpt-4o"))
	apiErr := errorWithStatus(http.StatusInternalServerError)

	Finish(record, &apiErr)

	// 非 429 错误既不抬峰也不收紧；这里的 1 来自 Begin 时记录到的并发
	assert.Equal(t, 1, TakeSnapshot().Peaks["gpt-4o"])
}

func TestPeakKeepsHighWaterMarkWithoutRejections(t *testing.T) {
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
