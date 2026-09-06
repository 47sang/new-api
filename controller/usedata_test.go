package controller

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// GetDailyQuotaDates 会查询 quota_data，成功路径需要可用的 model.DB。
// 与 auth_flow_test 相同：保存 previousDB，Cleanup 恢复，避免污染并行包内其他测试
func setupUsageDailyDB(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.QuotaData{}))
	model.DB = db
	t.Cleanup(func() { model.DB = previousDB })
}

func callDailyQuotaDates(t *testing.T, query string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/data/daily?"+query, nil)
	GetDailyQuotaDates(context)
	return recorder
}

func TestGetDailyQuotaDatesValidation(t *testing.T) {
	setupUsageDailyDB(t)

	const day = int64(86400)

	tests := []struct {
		name    string
		query   string
		message string
	}{
		{
			name:    "missing start_timestamp",
			query:   "end_timestamp=" + strconv.FormatInt(10*day, 10),
			message: "invalid start_timestamp",
		},
		{
			name:    "reversed time range",
			query:   "start_timestamp=" + strconv.FormatInt(10*day, 10) + "&end_timestamp=" + strconv.FormatInt(day, 10),
			message: "invalid time range",
		},
		{
			name:    "tz_offset out of range",
			query:   "start_timestamp=" + strconv.FormatInt(day, 10) + "&end_timestamp=" + strconv.FormatInt(2*day, 10) + "&tz_offset=99999",
			message: "invalid tz_offset",
		},
		{
			name:    "with_models span exceeds 190 days",
			query:   "start_timestamp=" + strconv.FormatInt(day, 10) + "&end_timestamp=" + strconv.FormatInt(200*day, 10) + "&with_models=true",
			message: "时间跨度超过允许范围",
		},
		{
			name:    "without models span exceeds 400 days",
			query:   "start_timestamp=" + strconv.FormatInt(day, 10) + "&end_timestamp=" + strconv.FormatInt(402*day, 10),
			message: "时间跨度超过允许范围",
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			recorder := callDailyQuotaDates(t, testCase.query)
			assert.Equal(t, http.StatusOK, recorder.Code)
			assert.Contains(t, recorder.Body.String(), `"success":false`)
			assert.Contains(t, recorder.Body.String(), testCase.message)
		})
	}
}

// 合法请求走通全链路并返回按天聚合数据
func TestGetDailyQuotaDatesSuccess(t *testing.T) {
	setupUsageDailyDB(t)

	const day = int64(86400)
	require.NoError(t, model.DB.Create(&model.QuotaData{
		ModelName: "gpt-4o",
		CreatedAt: 5 * day,
		Count:     2,
		Quota:     20,
		TokenUsed: 200,
	}).Error)

	recorder := callDailyQuotaDates(t,
		"start_timestamp="+strconv.FormatInt(4*day, 10)+
			"&end_timestamp="+strconv.FormatInt(6*day, 10)+
			"&with_models=true")

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"success":true`)
	assert.Contains(t, recorder.Body.String(), "gpt-4o")
	assert.Contains(t, recorder.Body.String(), strconv.FormatInt(5*day, 10))
}
