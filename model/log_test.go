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
