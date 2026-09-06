package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func seedQuotaData(t *testing.T, rows []*QuotaData) {
	t.Helper()
	require.NoError(t, DB.Create(&rows).Error)
}

// 验证 GetQuotaDataDaily 按天×模型聚合：同一模型同一天的多条小时记录
// 合并为一行，count/quota/token_used 分别求和，created_at 为本地日 0 点伪时间戳。
func TestGetQuotaDataDaily_GroupByModel(t *testing.T) {
	truncateTables(t)

	const day0 = int64(86400 * 100)
	seedQuotaData(t, []*QuotaData{
		{ModelName: "gpt-4o", CreatedAt: day0 + 3600, Count: 2, Quota: 100, TokenUsed: 300},
		{ModelName: "gpt-4o", CreatedAt: day0 + 7200, Count: 3, Quota: 50, TokenUsed: 700},
		{ModelName: "claude-3", CreatedAt: day0 + 3600, Count: 1, Quota: 10, TokenUsed: 90},
		{ModelName: "gpt-4o", CreatedAt: day0 + 86400, Count: 4, Quota: 40, TokenUsed: 400},
	})

	rows, err := GetQuotaDataDaily(day0, day0+2*86400, 0, true)
	require.NoError(t, err)
	require.Len(t, rows, 3)

	byKey := make(map[string]*QuotaData)
	for _, row := range rows {
		byKey[row.ModelName] = row
	}

	gptDay0 := byKey["gpt-4o"]
	require.NotNil(t, gptDay0, "gpt-4o 应有两行（day0 与 day1）")
	// 同模型出现两行，逐行校验
	var day0Rows []*QuotaData
	for _, row := range rows {
		if row.ModelName == "gpt-4o" && row.CreatedAt == day0 {
			day0Rows = append(day0Rows, row)
		}
	}
	require.Len(t, day0Rows, 1)
	assert.Equal(t, 5, day0Rows[0].Count)
	assert.Equal(t, 150, day0Rows[0].Quota)
	assert.Equal(t, 1000, day0Rows[0].TokenUsed)

	claudeDay0 := byKey["claude-3"]
	require.NotNil(t, claudeDay0)
	assert.Equal(t, day0, claudeDay0.CreatedAt)
	assert.Equal(t, 1, claudeDay0.Count)

	var gptDay1 []*QuotaData
	for _, row := range rows {
		if row.ModelName == "gpt-4o" && row.CreatedAt == day0+86400 {
			gptDay1 = append(gptDay1, row)
		}
	}
	require.Len(t, gptDay1, 1)
	assert.Equal(t, 4, gptDay1[0].Count)
}

// 验证时区偏移改变天边界：UTC 日界两侧的两条记录在 UTC+8 下归入同一天。
func TestGetQuotaDataDaily_TimezoneOffset(t *testing.T) {
	truncateTables(t)

	const day100 = int64(86400 * 100)
	const tzPlus8 = int64(28800)
	seedQuotaData(t, []*QuotaData{
		// UTC day 99 的最后一秒与 UTC day 100 的第一秒
		{ModelName: "m", CreatedAt: day100 - 1, Count: 1, Quota: 1, TokenUsed: 1},
		{ModelName: "m", CreatedAt: day100, Count: 1, Quota: 2, TokenUsed: 2},
	})

	rows, err := GetQuotaDataDaily(day100-86400, day100+86400, tzPlus8, true)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	// (day100 - 1 + 28800) 与 (day100 + 28800) 都落在偏移后的 day100
	assert.Equal(t, day100, rows[0].CreatedAt)
	assert.Equal(t, 2, rows[0].Count)
	assert.Equal(t, 3, rows[0].Quota)
	assert.Equal(t, 3, rows[0].TokenUsed)

	// 不带偏移时两条分属两天
	rowsUTC, err := GetQuotaDataDaily(day100-86400, day100+86400, 0, true)
	require.NoError(t, err)
	require.Len(t, rowsUTC, 2)
}

// 验证 groupByModel=false 时同一天多模型合并为一行且不含模型维度。
func TestGetQuotaDataDaily_WithoutModelDimension(t *testing.T) {
	truncateTables(t)

	const day0 = int64(86400 * 200)
	seedQuotaData(t, []*QuotaData{
		{ModelName: "gpt-4o", CreatedAt: day0 + 3600, Count: 2, Quota: 100, TokenUsed: 300},
		{ModelName: "claude-3", CreatedAt: day0 + 7200, Count: 3, Quota: 50, TokenUsed: 700},
	})

	rows, err := GetQuotaDataDaily(day0, day0+86400, 0, false)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Empty(t, rows[0].ModelName)
	assert.Equal(t, 5, rows[0].Count)
	assert.Equal(t, 150, rows[0].Quota)
	assert.Equal(t, 1000, rows[0].TokenUsed)
}

// 验证空表返回空集、时间范围过滤生效。
func TestGetQuotaDataDaily_EmptyAndRangeFilter(t *testing.T) {
	truncateTables(t)

	rows, err := GetQuotaDataDaily(0, 86400, 0, true)
	require.NoError(t, err)
	assert.Empty(t, rows)

	const day0 = int64(86400 * 300)
	seedQuotaData(t, []*QuotaData{
		{ModelName: "m", CreatedAt: day0, Count: 1, Quota: 1, TokenUsed: 1},
		{ModelName: "m", CreatedAt: day0 + 10*86400, Count: 1, Quota: 1, TokenUsed: 1},
	})

	rows, err = GetQuotaDataDaily(day0, day0+86400, 0, true)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, day0, rows[0].CreatedAt)
}
