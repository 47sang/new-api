package model

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// runDeleteOldLogBatchLimitCheck 在给定数据库上验证分批删除的跨库契约：
// 每批删除行数不得超过 limit，且最终把范围内行删干净、范围外行不动。
// 该写法（先按 created_at 取主键、再按主键删除）必须同时适用于 SQLite/MySQL/PostgreSQL：
// 旧实现依赖 GORM 的 Where(...).Limit(...).Delete(...)，而 GORM 的 Delete 语句不渲染
// LIMIT，在任何数据库上都会一次性删除全部命中行。
func runDeleteOldLogBatchLimitCheck(t *testing.T, db *gorm.DB, dbType common.DatabaseType) {
	t.Helper()

	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })

	// 复用 logs 表名（DeleteOldLogBatch 走 Model(&Log{}) 的固定表名），用完即删
	require.NoError(t, db.Migrator().DropTable("logs"))
	t.Cleanup(func() { _ = db.Migrator().DropTable("logs") })
	require.NoError(t, db.AutoMigrate(&Log{}))

	previousDB, previousType := LOG_DB, common.LogDatabaseType()
	LOG_DB = db
	common.SetLogDatabaseType(dbType)
	t.Cleanup(func() {
		LOG_DB = previousDB
		common.SetLogDatabaseType(previousType)
	})

	const target = int64(1_700_000_000)
	// 用当前时间附近的时间戳，避免与库里可能存在的其它数据相撞
	now := time.Now().Unix()
	logs := make([]Log, 0, 7)
	for i := range 5 {
		logs = append(logs, Log{UserId: 1, CreatedAt: now - int64(i+1)*60, Type: LogTypeConsume, Content: "old"})
	}
	for i := range 2 {
		logs = append(logs, Log{UserId: 1, CreatedAt: now + int64(i+1)*60, Type: LogTypeConsume, Content: "new"})
	}
	require.NoError(t, db.Create(&logs).Error)

	var batches []int64
	for {
		deleted, err := DeleteOldLogBatch(t.Context(), now, 2)
		require.NoError(t, err)
		if deleted == 0 {
			break
		}
		require.LessOrEqual(t, deleted, int64(2), "单批删除行数不得超过 limit")
		batches = append(batches, deleted)
	}
	assert.Equal(t, []int64{2, 2, 1}, batches)

	var remainingOld, remainingNew int64
	require.NoError(t, db.Model(&Log{}).Where("created_at < ?", now).Count(&remainingOld).Error)
	require.NoError(t, db.Model(&Log{}).Where("created_at >= ?", now).Count(&remainingNew).Error)
	assert.Zero(t, remainingOld)
	assert.EqualValues(t, 2, remainingNew)
}

// TestDeleteOldLogBatchRespectsLimitOnMySQL 验证 MySQL 上的分批删除同样受 limit 约束
func TestDeleteOldLogBatchRespectsLimitOnMySQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	runDeleteOldLogBatchLimitCheck(t, db, common.DatabaseTypeMySQL)
}

// TestDeleteOldLogBatchRespectsLimitOnPostgreSQL 验证 PostgreSQL 上的分批删除同样受 limit 约束
func TestDeleteOldLogBatchRespectsLimitOnPostgreSQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not configured")
	}
	db, err := gorm.Open(postgres.New(postgres.Config{
		DSN:                  dsn,
		PreferSimpleProtocol: true,
	}), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	runDeleteOldLogBatchLimitCheck(t, db, common.DatabaseTypePostgreSQL)
}
