package model

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// TestVacuumLogDatabaseReclaimsSQLiteFreePages 回归验证:SQLite 的 DELETE 只把释放页
// 挪进 freelist,数据库文件不会自动缩小;VacuumLogDatabase 必须把空闲页归零并让文件
// 实际变小,否则手动清理日志后磁盘占用始终不下降
func TestVacuumLogDatabaseReclaimsSQLiteFreePages(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "log.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	require.NoError(t, err)

	previousDB, previousType := LOG_DB, common.LogDatabaseType()
	LOG_DB = db
	common.SetLogDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		LOG_DB = previousDB
		common.SetLogDatabaseType(previousType)
	})

	require.NoError(t, db.AutoMigrate(&Log{}))
	// 写入约 20 MB 大文本后全部删除,制造滞留在文件中的空闲页
	bigContent := strings.Repeat("x", 1024*1024)
	logs := make([]Log, 0, 20)
	for i := 0; i < 20; i++ {
		logs = append(logs, Log{UserId: 1, CreatedAt: common.GetTimestamp(), Type: LogTypeConsume, Content: bigContent})
	}
	require.NoError(t, db.Create(&logs).Error)
	require.NoError(t, db.Exec("DELETE FROM logs").Error)

	var freelistBefore int64
	require.NoError(t, db.Raw("PRAGMA freelist_count").Scan(&freelistBefore).Error)
	require.Positive(t, freelistBefore, "删除后空闲页应滞留在文件中,否则该测试失去意义")
	sizeBefore, err := os.Stat(dbPath)
	require.NoError(t, err)

	vacuumed, err := VacuumLogDatabase(context.Background())
	require.NoError(t, err)
	require.True(t, vacuumed)

	var freelistAfter int64
	require.NoError(t, db.Raw("PRAGMA freelist_count").Scan(&freelistAfter).Error)
	assert.Equal(t, int64(0), freelistAfter)
	sizeAfter, err := os.Stat(dbPath)
	require.NoError(t, err)
	assert.Less(t, sizeAfter.Size(), sizeBefore.Size(), "VACUUM 后数据库文件应实际缩小")
}

// TestVacuumLogDatabaseSkipsNonSQLiteLogDB 验证非 SQLite 日志库直接跳过 VACUUM:
// MySQL/PostgreSQL/ClickHouse 的空间由数据库自身机制管理,重组语句会长时间锁表
func TestVacuumLogDatabaseSkipsNonSQLiteLogDB(t *testing.T) {
	previousType := common.LogDatabaseType()
	common.SetLogDatabaseType(common.DatabaseTypeMySQL)
	t.Cleanup(func() { common.SetLogDatabaseType(previousType) })

	vacuumed, err := VacuumLogDatabase(context.Background())
	require.NoError(t, err)
	assert.False(t, vacuumed)
}

// TestLogModelNamesDedupedAndFiltered 回归验证:模型名列表接口必须去重、剔除空模型名,
// 并按类型与时间窗过滤,供 Log4 模型筛选下拉使用;窗口外的请求记录不得泄漏进结果
func TestLogModelNamesDedupedAndFiltered(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "log.db")), &gorm.Config{})
	require.NoError(t, err)

	previousDB := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previousDB })

	require.NoError(t, db.AutoMigrate(&Log{}))

	const windowStart int64 = 1000
	const windowEnd int64 = 2000
	logs := []*Log{
		{UserId: 1, CreatedAt: 1500, Type: LogTypeConsume, ModelName: "gpt-4o"},
		// 同模型重复请求只保留一个模型名
		{UserId: 1, CreatedAt: 1600, Type: LogTypeConsume, ModelName: "gpt-4o"},
		{UserId: 1, CreatedAt: 1700, Type: LogTypeConsume, ModelName: "glm-5.3-flash"},
		// 空模型名必须被剔除
		{UserId: 1, CreatedAt: 1800, Type: LogTypeConsume, ModelName: ""},
		// 窗口外的记录不计入
		{UserId: 1, CreatedAt: 500, Type: LogTypeConsume, ModelName: "out-of-window"},
		// 类型过滤命中前的记录
		{UserId: 1, CreatedAt: 1900, Type: LogTypeError, ModelName: "error-only"},
	}
	require.NoError(t, db.Create(&logs).Error)

	// 全类型查询包含窗口内的错误日志记录
	all, err := GetAllLogModelNames(LogTypeUnknown, windowStart, windowEnd)
	require.NoError(t, err)
	assert.Equal(t, []string{"error-only", "glm-5.3-flash", "gpt-4o"}, all)

	consume, err := GetAllLogModelNames(LogTypeConsume, windowStart, windowEnd)
	require.NoError(t, err)
	assert.Equal(t, []string{"glm-5.3-flash", "gpt-4o"}, consume)

	userModels, err := GetUserLogModelNames(1, LogTypeConsume, windowStart, windowEnd)
	require.NoError(t, err)
	assert.Equal(t, []string{"glm-5.3-flash", "gpt-4o"}, userModels)

	otherUser, err := GetUserLogModelNames(2, LogTypeConsume, windowStart, windowEnd)
	require.NoError(t, err)
	assert.Empty(t, otherUser)

	// 不传时间窗时返回全部模型名
	noWindow, err := GetAllLogModelNames(LogTypeUnknown, 0, 0)
	require.NoError(t, err)
	assert.Equal(t, []string{"error-only", "glm-5.3-flash", "gpt-4o", "out-of-window"}, noWindow)
}
