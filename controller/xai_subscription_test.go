package controller

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// xAI 订阅渠道的准入校验：密钥只能是订阅登录产生的 OAuth JSON。
func TestValidateChannelXaiSubscriptionKey(t *testing.T) {
	cases := []struct {
		name    string
		key     string
		isAdd   bool
		wantErr bool
	}{
		{name: "add without key rejected", key: "", isAdd: true, wantErr: true},
		{name: "plain api key rejected", key: "sk-xai-plain", isAdd: true, wantErr: true},
		{name: "json without access_token rejected", key: `{"refresh_token":"rt"}`, isAdd: true, wantErr: true},
		{name: "valid key accepted", key: `{"access_token":"at","refresh_token":"rt"}`, isAdd: true},
		// 缺 refresh_token 只是不能自动续期，不阻断保存（界面会提示）
		{name: "missing refresh_token accepted", key: `{"access_token":"at"}`, isAdd: true},
		{name: "edit without key accepted", key: "", isAdd: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			channel := &model.Channel{Type: constant.ChannelTypeXaiSub, Key: tc.key}
			err := validateChannel(channel, tc.isAdd)
			if tc.wantErr {
				require.Error(t, err)
				if tc.key != "" {
					assert.NotContains(t, err.Error(), tc.key)
				}
				return
			}
			require.NoError(t, err)
		})
	}
}

// 订阅渠道的模型补 0 价；已调过价的不覆盖；别的渠道类型不受影响。
func TestEnsureXaiSubscriptionModelsFree(t *testing.T) {
	setupXaiPricingTestDB(t)

	// 预置一个已调过价的模型（模拟管理员手工调价）
	require.NoError(t, model.UpdateModelPricingOptions(map[string]string{
		"ModelRatio":      `{"grok-4-1-fast-reasoning":12.5}`,
		"CompletionRatio": `{"grok-4-1-fast-reasoning":37.5}`,
	}))

	EnsureXaiSubscriptionModelsFree([]model.Channel{
		{Type: constant.ChannelTypeXaiSub, Models: "grok-4-1-fast-reasoning,grok-4-fast-reasoning"},
		// 别的渠道类型不碰
		{Type: constant.ChannelTypeXai, Models: "grok-2-vision-1212"},
	})

	// 新模型补 0
	ratio, ok, _ := ratio_setting.GetModelRatio("grok-4-fast-reasoning")
	require.True(t, ok, "new subscription model must be priced")
	assert.Equal(t, 0.0, ratio)
	assert.Equal(t, 0.0, ratio_setting.GetCompletionRatio("grok-4-fast-reasoning"))

	// 管理员调过价的不被覆盖
	ratio, ok, _ = ratio_setting.GetModelRatio("grok-4-1-fast-reasoning")
	require.True(t, ok)
	assert.Equal(t, 12.5, ratio)
	assert.Equal(t, 37.5, ratio_setting.GetCompletionRatio("grok-4-1-fast-reasoning"))

	// 别的渠道类型的模型不动（落到默认倍率，ok=false 表示未显式配置）
	_, ok, _ = ratio_setting.GetModelRatio("grok-2-vision-1212")
	assert.False(t, ok)
}

// 没有模型的订阅渠道不该写任何价格。
func TestEnsureXaiSubscriptionModelsFreeNoModels(t *testing.T) {
	setupXaiPricingTestDB(t)
	EnsureXaiSubscriptionModelsFree([]model.Channel{
		{Type: constant.ChannelTypeXaiSub, Models: ""},
		{Type: constant.ChannelTypeOpenAI, Models: "gpt-5"},
	})
	_, ok, _ := ratio_setting.GetModelRatio("gpt-5")
	assert.False(t, ok)
}

func setupXaiPricingTestDB(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	previousType := common.MainDatabaseType()
	previousMaster, previousCache, previousRedis, previousSQLite := common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled, common.SQLitePath
	t.Cleanup(func() {
		model.DB = previousDB
		common.SetDatabaseTypes(previousType, previousType)
		common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled, common.SQLitePath = previousMaster, previousCache, previousRedis, previousSQLite
	})
	t.Setenv("SQL_DSN", "")
	common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled = false, false, false
	common.SQLitePath = filepath.Join(t.TempDir(), "xai-pricing.db")
	require.NoError(t, model.InitDB())
	database := model.DB
	sqlDB, err := database.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, database.AutoMigrate(&model.Option{}))
	model.InitOptionMap()
	_ = os.Setenv("TEST_XAI_PRICING", "1")
}
