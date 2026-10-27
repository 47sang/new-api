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

// TestExtractSessionId 验证会话标识提取只认 Claude Code 的结构化 metadata.user_id：
// 该字段是"字符串里套 JSON"，普通字符串（客户端自填的 user_id）标识的是终端用户
// 而非对话，按它分组会把不同对话并成一条线
func TestExtractSessionId(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{
			name: "Claude Code 结构化 metadata.user_id",
			body: `{"model":"claude-opus-4-8","metadata":{"user_id":"{\"device_id\":\"abc\",\"account_uuid\":\"\",\"session_id\":\"68ee85fe-e797-4ee6-922f-e63364dc5348\"}"}}`,
			want: "68ee85fe-e797-4ee6-922f-e63364dc5348",
		},
		{
			name: "普通字符串 user_id 不当会话标识",
			body: `{"model":"gpt-4o","metadata":{"user_id":"user_12345"}}`,
			want: "",
		},
		{
			name: "没有 metadata",
			body: `{"model":"gpt-4o","messages":[]}`,
			want: "",
		},
		{
			name: "metadata.user_id 是非法 JSON 文本",
			body: `{"metadata":{"user_id":"{not json"}}`,
			want: "",
		},
		{
			name: "session_id 为空",
			body: `{"metadata":{"user_id":"{\"device_id\":\"abc\",\"session_id\":\"\"}"}}`,
			want: "",
		},
		{
			name: "session_id 超过列宽上限",
			body: `{"metadata":{"user_id":"{\"session_id\":\"` + strings.Repeat("s", 65) + `\"}"}}`,
			want: "",
		},
		{
			name: "请求体不是 JSON",
			body: `not json at all`,
			want: "",
		},
		{
			name: "空请求体",
			body: ``,
			want: "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, extractSessionId(tc.body))
		})
	}
}

// TestSaveRequestResponseLogStoresSessionId 验证落库时提取并写入会话标识，
// 且 UPSERT 覆盖时同步更新（重复保存不会把会话标识留成旧值）
func TestSaveRequestResponseLogStoresSessionId(t *testing.T) {
	require.NoError(t, LOG_DB.AutoMigrate(&RequestResponseLog{}))

	previous := common.RequestResponseLogEnabled
	common.RequestResponseLogEnabled = true
	t.Cleanup(func() { common.RequestResponseLogEnabled = previous })

	body := `{"metadata":{"user_id":"{\"session_id\":\"sess-store-1\"}"}}`
	SaveRequestResponseLog("rrl-session-store", body, "resp", false, true, 4, 200)

	saved, err := GetRequestResponseLogByRequestId("rrl-session-store")
	require.NoError(t, err)
	assert.Equal(t, "sess-store-1", saved.SessionId)

	otherSession := `{"metadata":{"user_id":"{\"session_id\":\"sess-store-2\"}"}}`
	SaveRequestResponseLog("rrl-session-store", otherSession, "resp2", false, true, 5, 200)
	saved, err = GetRequestResponseLogByRequestId("rrl-session-store")
	require.NoError(t, err)
	assert.Equal(t, "sess-store-2", saved.SessionId, "UPSERT 必须同步更新 session_id")
}

// TestGetLogsBySessionIdScopesToUser 验证会话轮次查询按用户隔离：
// 同一会话里混有他人轮次时，普通用户只能看到自己的，且空结果不报错。
// 用临时库隔离：模型测试包共享 LOG_DB，别的测试留下的行会污染计数
func TestGetLogsBySessionIdScopesToUser(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "rrl-session-scope.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	require.NoError(t, err)

	previousDB := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previousDB })
	require.NoError(t, db.AutoMigrate(&RequestResponseLog{}, &Log{}))

	const sessionId = "sess-scope-1"
	rrRows := []RequestResponseLog{
		{RequestId: "rrl-scope-1", RequestBody: "a", SessionId: sessionId, CreatedAt: 100},
		{RequestId: "rrl-scope-2", RequestBody: "b", SessionId: sessionId, CreatedAt: 200},
		{RequestId: "rrl-scope-3", RequestBody: "c", SessionId: sessionId, CreatedAt: 300},
		{RequestId: "rrl-scope-4", RequestBody: "d", SessionId: "sess-other", CreatedAt: 400},
		{RequestId: "rrl-scope-5", RequestBody: "e", SessionId: "", CreatedAt: 500},
	}
	require.NoError(t, db.Create(&rrRows).Error)

	logRows := []*Log{
		{UserId: 7, RequestId: "rrl-scope-1", ModelName: "m1", CreatedAt: 100},
		{UserId: 7, RequestId: "rrl-scope-2", ModelName: "m2", CreatedAt: 200},
		{UserId: 9, RequestId: "rrl-scope-3", ModelName: "other-user", CreatedAt: 300},
		{UserId: 7, RequestId: "rrl-scope-5", ModelName: "no-session", CreatedAt: 500},
	}
	require.NoError(t, db.Create(&logRows).Error)

	// 管理员视角：同一会话的三轮都在，未标会话或别会话的行不出现
	adminLogs, err := GetLogsBySessionId(sessionId, 0, 0)
	require.NoError(t, err)
	require.Len(t, adminLogs, 3)
	assert.Equal(t, "m1", adminLogs[0].ModelName, "必须按时间正序返回")
	assert.Equal(t, "m2", adminLogs[1].ModelName)
	assert.Equal(t, "other-user", adminLogs[2].ModelName)

	// 普通用户视角：只保留属于自己的那两轮，他人的轮次被过滤掉
	userLogs, err := GetLogsBySessionId(sessionId, 7, 0)
	require.NoError(t, err)
	require.Len(t, userLogs, 2)
	for _, row := range userLogs {
		assert.Equal(t, 7, row.UserId)
	}

	// 不属于任何用户的会话：查不到即空列表，由调用方按 not found 处理
	strangerLogs, err := GetLogsBySessionId(sessionId, 42, 0)
	require.NoError(t, err)
	assert.Empty(t, strangerLogs)

	// 空会话标识直接返回空，不打库
	emptyLogs, err := GetLogsBySessionId("", 0, 0)
	require.NoError(t, err)
	assert.Empty(t, emptyLogs)
}

// TestBackfillRequestResponseLogSessionIds 验证历史行回填：只补有空串的行，
// 同一批同会话的多行合并更新，重复回填是幂等的（不会反复扫已填好的行）。
// 用临时库隔离：共享 LOG_DB 里别的测试留下的无会话行会污染扫描计数
func TestBackfillRequestResponseLogSessionIds(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "rrl-backfill.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	require.NoError(t, err)

	previousDB := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previousDB })
	require.NoError(t, db.AutoMigrate(&RequestResponseLog{}))

	withSession := `{"metadata":{"user_id":"{\"session_id\":\"sess-fill-1\"}"}}`
	rows := []RequestResponseLog{
		{RequestId: "rrl-fill-1", RequestBody: withSession, CreatedAt: 100},
		{RequestId: "rrl-fill-2", RequestBody: withSession, CreatedAt: 200},
		{RequestId: "rrl-fill-3", RequestBody: `{"model":"gpt-4o"}`, CreatedAt: 300},
		{RequestId: "rrl-fill-4", RequestBody: withSession, CreatedAt: 400},
		{RequestId: "rrl-fill-5", RequestBody: withSession, SessionId: "already-filled", CreatedAt: 500},
	}
	require.NoError(t, db.Create(&rows).Error)

	scanned, updated, err := BackfillRequestResponseLogSessionIds(2)
	require.NoError(t, err)
	assert.Equal(t, int64(4), scanned, "必须扫完所有缺会话标识的行")
	assert.Equal(t, int64(3), updated, "三条带标识的行被回填，无标识的那条保持空串")

	for _, id := range []string{"rrl-fill-1", "rrl-fill-2", "rrl-fill-4"} {
		row, err := GetRequestResponseLogByRequestId(id)
		require.NoError(t, err)
		assert.Equal(t, "sess-fill-1", row.SessionId)
	}
	row, err := GetRequestResponseLogByRequestId("rrl-fill-3")
	require.NoError(t, err)
	assert.Empty(t, row.SessionId, "没有会话标识的请求体不能被硬塞一个")

	// 幂等：再跑一遍不再更新任何行；唯一被重新扫到的是那条请求体里
	// 根本没有会话标识的行——它填不上，但也不该被硬塞一个
	scanned, updated, err = BackfillRequestResponseLogSessionIds(2)
	require.NoError(t, err)
	assert.Equal(t, int64(1), scanned, "只有填不上的行会被重复扫到")
	assert.Zero(t, updated, "已回填的行不会被重复更新")

	remaining, err := CountRequestResponseLogsMissingSessionId()
	require.NoError(t, err)
	assert.Equal(t, int64(1), remaining, "仅剩那条本来就没有会话标识的行")
}

// TestCleanupRunsWhenFeatureDisabled 回归验证：保留期清理不受功能开关控制。
// 历史实现在 cleanupRequestResponseLogs 开头检查 RequestResponseLogEnabled，
// 关闭开关后清理一起停摆——线上因此出现开关关闭两周、1GB 存量数据一天未清的情况。
func TestCleanupRunsWhenFeatureDisabled(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "rrl-cleanup-when-off.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	require.NoError(t, err)

	previousDB := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previousDB })
	require.NoError(t, db.AutoMigrate(&RequestResponseLog{}))

	const retentionDays = 3
	cutoff := time.Now().Unix() - retentionDays*24*60*60
	require.NoError(t, db.Create(&[]RequestResponseLog{
		{RequestId: "rrl-off-expired", RequestBody: "old", CreatedAt: cutoff - 60},
		{RequestId: "rrl-off-fresh", RequestBody: "new", CreatedAt: time.Now().Unix()},
	}).Error)

	previousEnabled := common.RequestResponseLogEnabled
	common.RequestResponseLogEnabled = false
	t.Cleanup(func() { common.RequestResponseLogEnabled = previousEnabled })

	previousRetention := common.RequestResponseLogRetentionDays
	common.RequestResponseLogRetentionDays = retentionDays
	t.Cleanup(func() { common.RequestResponseLogRetentionDays = previousRetention })

	cleanupRequestResponseLogs()

	var remainingExpired int64
	require.NoError(t, db.Model(&RequestResponseLog{}).Where("request_id = ?", "rrl-off-expired").Count(&remainingExpired).Error)
	assert.Zero(t, remainingExpired, "功能关闭时过期行也必须被清理")

	kept, err := GetRequestResponseLogByRequestId("rrl-off-fresh")
	require.NoError(t, err)
	require.NotNil(t, kept, "保留期内的行不受影响")
}

// TestTriggerCleanupWhileRunningIsNotDropped 验证触发不重叠也不丢弃：
// 清理正在跑时又来一次触发（管理员连续改保留期），触发只登记待办而不被悄悄丢掉，
// 由在跑的那一轮跑完后补跑——丢掉的话新保留期要等最多 24 小时才生效
func TestTriggerCleanupWhileRunningIsNotDropped(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "rrl-trigger-race.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	require.NoError(t, err)

	previousDB := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previousDB })
	require.NoError(t, db.AutoMigrate(&RequestResponseLog{}))

	previousRetention := common.RequestResponseLogRetentionDays
	t.Cleanup(func() { common.RequestResponseLogRetentionDays = previousRetention })
	common.RequestResponseLogRetentionDays = 1
	require.False(t, cleanupPending.Load())

	cutoff := time.Now().Unix() - 10*24*60*60
	require.NoError(t, db.Create(&[]RequestResponseLog{
		{RequestId: "rrl-race-1", RequestBody: "x", CreatedAt: cutoff},
		{RequestId: "rrl-race-2", RequestBody: "x", CreatedAt: cutoff},
	}).Error)

	// 持锁模拟「清理正在跑」：此时的触发只登记待办，不丢也不叠加
	require.True(t, cleanupMu.TryLock())
	TriggerRequestResponseLogCleanupAsync()
	require.True(t, cleanupPending.Load(), "清理在跑时触发必须登记待办")
	cleanupMu.Unlock()

	// 在跑的那一轮结束后补跑：重新触发即可拿到锁并驱动循环消费待办
	TriggerRequestResponseLogCleanupAsync()
	require.Eventually(t, func() bool {
		var n int64
		require.NoError(t, db.Model(&RequestResponseLog{}).Count(&n).Error)
		return n == 0
	}, 5*time.Second, 50*time.Millisecond, "清理在跑时的触发不能被丢弃")
	require.False(t, cleanupPending.Load(), "补跑结束后待办必须清零")
}

// TestRequestResponseLogRetentionDaysOption 验证保留期走 Option 通道、实时生效：
// 系统设置里改这个键时，运行时变量立即更新（下一个清理 tick 即按新值清理），
// 且该键注册在 OptionMap 中，前端设置页才能拿到并回显当前值
func TestRequestResponseLogRetentionDaysOption(t *testing.T) {
	previous := common.RequestResponseLogRetentionDays
	t.Cleanup(func() { common.RequestResponseLogRetentionDays = previous })
	// updateOptionMap 会写 OptionMap；测试包里该 map 未初始化，按既有测试的做法自建后还原
	previousMap := common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() { common.OptionMap = previousMap })

	require.NoError(t, updateOptionMap("RequestResponseLogRetentionDays", "7"))
	assert.Equal(t, 7, common.RequestResponseLogRetentionDays)
	assert.Equal(t, "7", common.OptionMap["RequestResponseLogRetentionDays"], "必须注册进 OptionMap 供前端读取")

	// 负值按 0（永久保留）处理，与启动时语义一致
	require.NoError(t, updateOptionMap("RequestResponseLogRetentionDays", "-1"))
	assert.Equal(t, 0, common.RequestResponseLogRetentionDays)

	// 非法值必须被校验挡住，不能把运行期变量改成脏值
	require.Error(t, validateOptionValue("RequestResponseLogRetentionDays", "abc"))
	require.Error(t, validateOptionValue("RequestResponseLogRetentionDays", "-3"))
	require.NoError(t, validateOptionValue("RequestResponseLogRetentionDays", "0"))
}

// TestCleanupReadsRetentionEachRun 验证保留期实时生效：清理函数每轮现读
// common.RequestResponseLogRetentionDays，管理员在前端改值后无需重启即按新值清理。
// 0 表示永久保留，此时一行都不删。
func TestCleanupReadsRetentionEachRun(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "rrl-retention-live.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	require.NoError(t, err)

	previousDB := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previousDB })
	require.NoError(t, db.AutoMigrate(&RequestResponseLog{}))

	previousRetention := common.RequestResponseLogRetentionDays
	t.Cleanup(func() { common.RequestResponseLogRetentionDays = previousRetention })

	cutoff := time.Now().Unix() - 10*24*60*60
	require.NoError(t, db.Create(&[]RequestResponseLog{
		{RequestId: "rrl-live-10d", RequestBody: "old", CreatedAt: cutoff},
		{RequestId: "rrl-live-now", RequestBody: "new", CreatedAt: time.Now().Unix()},
	}).Error)

	// 保留期 30 天：10 天前的行还在保留期内，不删
	common.RequestResponseLogRetentionDays = 30
	cleanupRequestResponseLogs()
	kept, err := GetRequestResponseLogByRequestId("rrl-live-10d")
	require.NoError(t, err)
	require.NotNil(t, kept, "保留期 30 天时 10 天前的行必须保留")

	// 改成 5 天：同一轮数据、新保留期下应立即删除（无需重启）
	common.RequestResponseLogRetentionDays = 5
	cleanupRequestResponseLogs()
	_, err = GetRequestResponseLogByRequestId("rrl-live-10d")
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound, "保留期改为 5 天后 10 天前的行必须被清掉")

	// 改成 0（永久保留）：不再删除任何行
	require.NoError(t, db.Create(&RequestResponseLog{RequestId: "rrl-live-ancient", RequestBody: "x", CreatedAt: cutoff}).Error)
	common.RequestResponseLogRetentionDays = 0
	cleanupRequestResponseLogs()
	kept, err = GetRequestResponseLogByRequestId("rrl-live-ancient")
	require.NoError(t, err)
	require.NotNil(t, kept, "保留期为 0 时任何行都不能被删")
}
