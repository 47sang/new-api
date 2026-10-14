package model

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func seedFlowQuotaData(t *testing.T, quotaData QuotaData) {
	t.Helper()
	require.NoError(t, DB.Create(&quotaData).Error)
}

func seedFlowLookupData(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.Create(&Channel{Id: 1, Name: "east"}).Error)
	require.NoError(t, DB.Create(&Channel{Id: 2, Name: "west"}).Error)
	require.NoError(t, DB.Create(&Token{Id: 11, UserId: 1, Key: "sk-primary", Name: "primary"}).Error)
	require.NoError(t, DB.Create(&Token{Id: 22, UserId: 2, Key: "sk-backup", Name: "backup"}).Error)
	require.NoError(t, DB.Delete(&Token{Id: 11}).Error)
}

func TestGetFlowQuotaDataUsesQuotaDataRoleSpecificDimensions(t *testing.T) {
	truncateTables(t)
	seedFlowLookupData(t)

	seedFlowQuotaData(t, QuotaData{
		UserID:    1,
		Username:  "alice",
		NodeName:  "node-a",
		TokenID:   11,
		UseGroup:  "vip",
		ModelName: "gpt-a",
		ChannelID: 1,
		CreatedAt: 1000,
		Count:     2,
		Quota:     100,
		TokenUsed: 40,
	})
	seedFlowQuotaData(t, QuotaData{
		UserID:    1,
		Username:  "alice",
		NodeName:  "node-a",
		TokenID:   11,
		UseGroup:  "vip",
		ModelName: "gpt-a",
		ChannelID: 1,
		CreatedAt: 1100,
		Count:     1,
		Quota:     50,
		TokenUsed: 20,
	})
	seedFlowQuotaData(t, QuotaData{
		UserID:    1,
		Username:  "alice",
		NodeName:  "node-a",
		TokenID:   11,
		UseGroup:  "vip",
		ModelName: "gpt-a",
		ChannelID: 2,
		CreatedAt: 1200,
		Count:     1,
		Quota:     25,
		TokenUsed: 10,
	})
	seedFlowQuotaData(t, QuotaData{
		UserID:    2,
		Username:  "bob",
		NodeName:  "node-b",
		TokenID:   22,
		UseGroup:  "default",
		ModelName: "gpt-b",
		ChannelID: 1,
		CreatedAt: 1300,
		Count:     3,
		Quota:     70,
		TokenUsed: 30,
	})
	seedFlowQuotaData(t, QuotaData{
		UserID:    1,
		Username:  "alice",
		ModelName: "legacy",
		CreatedAt: 1400,
		Count:     99,
		Quota:     999,
		TokenUsed: 999,
	})

	rootRows, err := GetFlowQuotaData(900, 2000, "", 0, common.RoleRootUser)
	require.NoError(t, err)
	require.Len(t, rootRows, 3)
	// Token 11 was soft-deleted, so its name is intentionally left empty for the
	// frontend to render a localized "deleted (id)" label instead.
	require.Equal(t, FlowQuotaData{
		UserID:      1,
		Username:    "alice",
		NodeName:    "node-a",
		TokenID:     11,
		TokenName:   "",
		UseGroup:    "vip",
		ChannelID:   1,
		ChannelName: "east",
		ModelName:   "gpt-a",
		TokenUsed:   60,
		Count:       3,
		Quota:       150,
	}, *rootRows[0])
	// A token that still exists resolves to its current name.
	require.Equal(t, 22, rootRows[1].TokenID)
	require.Equal(t, "backup", rootRows[1].TokenName)

	adminRows, err := GetFlowQuotaData(900, 2000, "alice", 0, common.RoleAdminUser)
	require.NoError(t, err)
	require.Len(t, adminRows, 2)
	require.Equal(t, 0, adminRows[0].TokenID)
	require.Empty(t, adminRows[0].TokenName)
	require.Empty(t, adminRows[0].NodeName)
	require.Equal(t, "alice", adminRows[0].Username)
	require.Equal(t, "vip", adminRows[0].UseGroup)
	require.Equal(t, "east", adminRows[0].ChannelName)
	require.Equal(t, 150, adminRows[0].Quota)

	selfRows, err := GetFlowQuotaData(900, 2000, "", 1, common.RoleCommonUser)
	require.NoError(t, err)
	require.Len(t, selfRows, 1)
	require.Empty(t, selfRows[0].Username)
	require.Equal(t, 0, selfRows[0].ChannelID)
	require.Empty(t, selfRows[0].ChannelName)
	require.Empty(t, selfRows[0].TokenName)
	require.Equal(t, "vip", selfRows[0].UseGroup)
	require.Equal(t, 175, selfRows[0].Quota)
}

func TestLogQuotaDataSplitsRowsByUseGroupTokenChannelAndNode(t *testing.T) {
	truncateTables(t)
	CacheQuotaDataLock.Lock()
	CacheQuotaData = make(map[string]*QuotaData)
	CacheQuotaDataLock.Unlock()

	LogQuotaData(QuotaDataLogParams{
		UserID:    1,
		Username:  "alice",
		ModelName: "gpt-a",
		CreatedAt: 3661,
		UseGroup:  "vip",
		TokenID:   11,
		ChannelID: 1,
		NodeName:  "node-a",
		Quota:     100,
		TokenUsed: 40,
	})
	LogQuotaData(QuotaDataLogParams{
		UserID:    1,
		Username:  "alice",
		ModelName: "gpt-a",
		CreatedAt: 3700,
		UseGroup:  "vip",
		TokenID:   11,
		ChannelID: 1,
		NodeName:  "node-a",
		Quota:     50,
		TokenUsed: 20,
	})
	LogQuotaData(QuotaDataLogParams{
		UserID:    1,
		Username:  "alice",
		ModelName: "gpt-a",
		CreatedAt: 3700,
		UseGroup:  "default",
		TokenID:   11,
		ChannelID: 1,
		NodeName:  "node-a",
		Quota:     25,
		TokenUsed: 10,
	})

	SaveQuotaDataCache()

	var rows []QuotaData
	require.NoError(t, DB.Order("quota DESC").Find(&rows).Error)
	require.Len(t, rows, 2)
	require.Equal(t, int64(3600), rows[0].CreatedAt)
	require.Equal(t, "vip", rows[0].UseGroup)
	require.Equal(t, 11, rows[0].TokenID)
	require.Equal(t, 1, rows[0].ChannelID)
	require.Equal(t, "node-a", rows[0].NodeName)
	require.Equal(t, 2, rows[0].Count)
	require.Equal(t, 150, rows[0].Quota)
	require.Equal(t, 60, rows[0].TokenUsed)
	require.Equal(t, "default", rows[1].UseGroup)
	require.Equal(t, 25, rows[1].Quota)
}

// 三段拆分必须与 count/quota/token_used 一样在两条累加路径上同步累加：
// 内存缓存合并与 increaseQuotaData 的增量 UPDATE 漏掉任何一列，
// 周期刷新后用量分析页的缓存拆分数据就会静默丢失。
func TestLogQuotaDataAccumulatesTokenSplitOnBothFlushPaths(t *testing.T) {
	truncateTables(t)
	CacheQuotaDataLock.Lock()
	CacheQuotaData = make(map[string]*QuotaData)
	CacheQuotaDataLock.Unlock()

	params := QuotaDataLogParams{
		UserID:              1,
		Username:            "alice",
		ModelName:           "gpt-a",
		CreatedAt:           3661,
		UseGroup:            "vip",
		TokenID:             11,
		ChannelID:           1,
		NodeName:            "node-a",
		Quota:               100,
		TokenUsed:           100,
		UncachedInputTokens: 60,
		CacheReadTokens:     30,
		OutputTokens:        10,
	}
	LogQuotaData(params)
	// 同一聚合键第二次累加：走内存缓存合并
	LogQuotaData(params)

	SaveQuotaDataCache()

	var row QuotaData
	require.NoError(t, DB.Where("model_name = ?", "gpt-a").First(&row).Error)
	require.Equal(t, 2, row.Count)
	require.Equal(t, 120, row.UncachedInputTokens)
	require.Equal(t, 60, row.CacheReadTokens)
	require.Equal(t, 20, row.OutputTokens)

	// 行已存在时再累加一次：走 increaseQuotaData 的增量 UPDATE
	LogQuotaData(params)
	SaveQuotaDataCache()

	require.NoError(t, DB.Where("model_name = ?", "gpt-a").First(&row).Error)
	require.Equal(t, 3, row.Count)
	require.Equal(t, 180, row.UncachedInputTokens)
	require.Equal(t, 90, row.CacheReadTokens)
	require.Equal(t, 30, row.OutputTokens)
}

func TestQuotaDataTokenSplit(t *testing.T) {
	anthropicOther := NewLogOther()
	anthropicOther.SetPublic("cache_tokens", 400)
	anthropicOther.SetPublic("usage_semantic", "anthropic")

	openaiOther := NewLogOther()
	openaiOther.SetPublic("cache_tokens", 400)

	tests := []struct {
		name           string
		other          *LogOther
		promptTokens   int
		completionToks int
		wantUncached   int
		wantCacheRead  int
		wantOutput     int
	}{
		{
			// anthropic 语义的 prompt_tokens 不含缓存读，不能扣除
			name:           "anthropic 语义不扣除缓存读",
			other:          anthropicOther,
			promptTokens:   600,
			completionToks: 200,
			wantUncached:   600,
			wantCacheRead:  400,
			wantOutput:     200,
		},
		{
			// 其余口径的 prompt_tokens 已含缓存命中，需扣除得到非缓存输入
			name:           "openai 语义扣除缓存读",
			other:          openaiOther,
			promptTokens:   600,
			completionToks: 200,
			wantUncached:   200,
			wantCacheRead:  400,
			wantOutput:     200,
		},
		{
			name:           "没有 other 时全部视为非缓存输入",
			other:          nil,
			promptTokens:   600,
			completionToks: 200,
			wantUncached:   600,
			wantCacheRead:  0,
			wantOutput:     200,
		},
		{
			name:           "扣除后不为负",
			other:          openaiOther,
			promptTokens:   100,
			completionToks: 0,
			wantUncached:   0,
			wantCacheRead:  400,
			wantOutput:     0,
		},
		{
			name:           "超大值钳制在 int32 边界",
			other:          nil,
			promptTokens:   math.MaxInt32 + 5,
			completionToks: math.MaxInt32 + 5,
			wantUncached:   math.MaxInt32,
			wantCacheRead:  0,
			wantOutput:     math.MaxInt32,
		},
		{
			name:           "负值钳制为 0",
			other:          nil,
			promptTokens:   -10,
			completionToks: -10,
			wantUncached:   0,
			wantCacheRead:  0,
			wantOutput:     0,
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			uncached, cacheRead, output := quotaDataTokenSplit(
				testCase.other,
				testCase.promptTokens,
				testCase.completionToks,
			)
			require.Equal(t, testCase.wantUncached, uncached)
			require.Equal(t, testCase.wantCacheRead, cacheRead)
			require.Equal(t, testCase.wantOutput, output)
		})
	}
}
