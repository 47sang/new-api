package model

import (
	"context"
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

// TestDeleteOldRequestResponseLogBatch 验证手动清理联动契约：仅删除目标时间戳之前
// 创建的行，之后的行保留，循环调用直至删完（供系统任务联动清理 request_response_logs 使用）
func TestDeleteOldRequestResponseLogBatch(t *testing.T) {
	require.NoError(t, LOG_DB.AutoMigrate(&RequestResponseLog{}))

	const target = int64(1_700_000_000)
	rows := []RequestResponseLog{
		{RequestId: "rrl-batch-old-1", RequestBody: "a", ResponseBody: "a", CreatedAt: target - 20},
		{RequestId: "rrl-batch-old-2", RequestBody: "b", ResponseBody: "b", CreatedAt: target - 10},
		{RequestId: "rrl-batch-new-1", RequestBody: "c", ResponseBody: "c", CreatedAt: target + 10},
	}
	require.NoError(t, LOG_DB.Create(&rows).Error)

	totalDeleted := int64(0)
	for {
		deleted, err := DeleteOldRequestResponseLogBatch(context.Background(), target, 1)
		require.NoError(t, err)
		if deleted == 0 {
			break
		}
		totalDeleted += deleted
	}
	assert.Equal(t, int64(2), totalDeleted)

	var remainingOld int64
	require.NoError(t, LOG_DB.Model(&RequestResponseLog{}).Where("created_at < ?", target).Count(&remainingOld).Error)
	assert.Equal(t, int64(0), remainingOld)

	_, err := GetRequestResponseLogByRequestId("rrl-batch-new-1")
	require.NoError(t, err) // 时间戳之后的行不受影响
}
