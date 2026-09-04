package model

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRequestResponseLogUpsertKeepsSingleRow 验证核心契约：
// 同一 request_id 重复保存时 UPSERT 覆盖，每请求最终只保留一行最新内容
func TestRequestResponseLogUpsertKeepsSingleRow(t *testing.T) {
	require.NoError(t, LOG_DB.AutoMigrate(&RequestResponseLog{}))

	previous := common.RequestResponseLogEnabled
	common.RequestResponseLogEnabled = true
	defer func() { common.RequestResponseLogEnabled = previous }()

	requestId := "req-resp-log-upsert-test"
	SaveRequestResponseLog(requestId, `{"model":"gpt-4o"}`, `first response`, false, true, 14, 200)
	SaveRequestResponseLog(requestId, `{"model":"gpt-4o"}`, `second response`, true, true, 15, 200)

	logs, err := GetRequestResponseLogByRequestId(requestId)
	require.NoError(t, err)
	assert.Equal(t, "second response", logs.ResponseBody)
	assert.True(t, logs.IsStream)
	assert.True(t, logs.IsCompleted)
	assert.Equal(t, 15, logs.ResponseSize)
	assert.Equal(t, 200, logs.StatusCode)

	var count int64
	require.NoError(t, LOG_DB.Model(&RequestResponseLog{}).Where("request_id = ?", requestId).Count(&count).Error)
	assert.Equal(t, int64(1), count)
}

// TestRequestResponseLogLargeBodyRoundTrip 验证响应体不截断：超大内容原样往返
func TestRequestResponseLogLargeBodyRoundTrip(t *testing.T) {
	require.NoError(t, LOG_DB.AutoMigrate(&RequestResponseLog{}))

	previous := common.RequestResponseLogEnabled
	common.RequestResponseLogEnabled = true
	defer func() { common.RequestResponseLogEnabled = previous }()

	requestId := "req-resp-log-large-body-test"
	largeBody := strings.Repeat("x", 3*1024*1024) // 3MB，超过旧实现的 2MB 截断阈值
	SaveRequestResponseLog(requestId, `{"model":"gpt-4o"}`, largeBody, false, true, len(largeBody), 200)

	logs, err := GetRequestResponseLogByRequestId(requestId)
	require.NoError(t, err)
	assert.Equal(t, len(largeBody), logs.ResponseSize)
	assert.Equal(t, largeBody, logs.ResponseBody)
}
