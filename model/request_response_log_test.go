package model

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
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

	// 每批都必须遵守 limit：GORM 的 Delete 语句不渲染 LIMIT，旧实现在第一批就把两行一起
	// 删掉——那会在数 GB 的表上形成巨型长事务、长时间独占写锁，把同库写入全堵成 SQLITE_BUSY
	var batches []int64
	for {
		deleted, err := DeleteOldRequestResponseLogBatch(context.Background(), target, 1)
		require.NoError(t, err)
		if deleted == 0 {
			break
		}
		require.LessOrEqual(t, deleted, int64(1), "单批删除行数不得超过 limit")
		batches = append(batches, deleted)
	}
	assert.Equal(t, []int64{1, 1}, batches, "limit=1 时必须一行一批删完")

	var remainingOld int64
	require.NoError(t, LOG_DB.Model(&RequestResponseLog{}).Where("created_at < ?", target).Count(&remainingOld).Error)
	assert.Equal(t, int64(0), remainingOld)

	_, err := GetRequestResponseLogByRequestId("rrl-batch-new-1")
	require.NoError(t, err) // 时间戳之后的行不受影响
}

// TestCleanupOldRequestResponseLogsDeletesInBatches 回归验证：保留期清理必须分批删除
// 并最终删完。历史实现是一条无上限的 DELETE，在单行可达数百 KB 的 request_response_logs
// 上会形成巨型长事务、长时间握住写锁，曾把同库的日志记录与额度批量更新全部堵成
// SQLITE_BUSY；中断后重跑还必须能把剩余行删干净。
func TestCleanupOldRequestResponseLogsDeletesInBatches(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "rrl-retention.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	require.NoError(t, err)

	previousDB := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previousDB })
	require.NoError(t, db.AutoMigrate(&RequestResponseLog{}))

	const retentionDays = 3
	const expiredCount = requestResponseLogCleanupBatchSize*2 + 50 // 250 行，超过单个批次
	cutoff := time.Now().Unix() - retentionDays*24*60*60

	expired := make([]RequestResponseLog, 0, expiredCount)
	for i := range expiredCount {
		expired = append(expired, RequestResponseLog{
			RequestId:   fmt.Sprintf("rrl-retention-old-%d", i),
			RequestBody: strings.Repeat("x", 1024),
			CreatedAt:   cutoff - int64(i+1),
		})
	}
	fresh := []RequestResponseLog{
		{RequestId: "rrl-retention-fresh-boundary", CreatedAt: cutoff + 60},
		{RequestId: "rrl-retention-fresh-now", CreatedAt: time.Now().Unix()},
	}
	require.NoError(t, db.Create(&expired).Error)
	require.NoError(t, db.Create(&fresh).Error)

	deleted, err := CleanupOldRequestResponseLogs(retentionDays)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, deleted, int64(expiredCount), "超过一个批期的存量必须被分批删完")

	var remainingExpired int64
	require.NoError(t, db.Model(&RequestResponseLog{}).Where("created_at < ?", cutoff).Count(&remainingExpired).Error)
	assert.Zero(t, remainingExpired, "早于保留期的行必须全部清除")

	for _, row := range fresh {
		kept, err := GetRequestResponseLogByRequestId(row.RequestId)
		require.NoError(t, err, "保留期内的行必须保留: %s", row.RequestId)
		require.NotNil(t, kept)
	}
}
