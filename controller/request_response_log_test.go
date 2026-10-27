package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// disabledRecordingMessage 是功能关闭时后端返回的控制台消息（英文源文案，
// 同时是前端语言文件的键）；前端据此展示友好提示而不是报错。
const disabledRecordingMessage = "Request/response recording is disabled. Enable it to view the input/output message details."

// callRequestResponseHandler 以指定身份调用请求/响应详情 handler，返回解析后的响应体。
func callRequestResponseHandler(t *testing.T, handler gin.HandlerFunc, userId, role int, logID, query string) map[string]any {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/log/request-response?"+query, nil)
	if logID != "" {
		ctx.Params = gin.Params{{Key: "id", Value: logID}}
	}
	ctx.Set("id", userId)
	ctx.Set("role", role)
	handler(ctx)
	var body map[string]any
	require.NoError(t, common.UnmarshalJsonStr(recorder.Body.String(), &body))
	return body
}

// useRequestResponseLogData 建库并写入三条日志（用户 1 的 a-1/a-2、用户 2 的 b-1）。
// withRecords 为 true 时迁移 request_response_logs 表并写入 a-1 的记录；为 false 时
// 不迁移该表，在 SQLite 上确定性复现 ClickHouse 日志库「表不存在」的查询失败。
func useRequestResponseLogData(t *testing.T, withRecords bool) {
	t.Helper()
	db, _ := newAuditTestDatabase(t, "sqlite", "")
	useLogExportDatabases(t, db, db, common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, db.AutoMigrate(&model.Log{}))
	if withRecords {
		require.NoError(t, db.AutoMigrate(&model.RequestResponseLog{}))
	}
	now := time.Now().Unix()
	logs := []model.Log{
		{Id: 1, UserId: 1, Username: "alice", Type: model.LogTypeConsume, ModelName: "gpt-4o", Quota: 10, RequestId: "a-1", CreatedAt: now},
		{Id: 2, UserId: 1, Username: "alice", Type: model.LogTypeConsume, ModelName: "gpt-4o", Quota: 10, RequestId: "a-2", CreatedAt: now},
		{Id: 3, UserId: 2, Username: "bob", Type: model.LogTypeConsume, ModelName: "gpt-4o", Quota: 10, RequestId: "b-1", CreatedAt: now},
	}
	for i := range logs {
		require.NoError(t, db.Create(&logs[i]).Error)
	}
	if withRecords {
		require.NoError(t, db.Create(&model.RequestResponseLog{
			RequestId:    "a-1",
			RequestBody:  `{"model":"gpt-4o"}`,
			ResponseBody: "ok",
			IsCompleted:  true,
			ResponseSize: 12,
			StatusCode:   200,
			CreatedAt:    now,
		}).Error)
	}
}

// setRequestResponseLogEnabled 切换全局开关，用例结束后恢复。
func setRequestResponseLogEnabled(t *testing.T, enabled bool) {
	t.Helper()
	previous := common.RequestResponseLogEnabled
	common.RequestResponseLogEnabled = enabled
	t.Cleanup(func() { common.RequestResponseLogEnabled = previous })
}

func TestGetRequestResponseByLogId(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("returns the stored bodies when recording is enabled", func(t *testing.T) {
		useRequestResponseLogData(t, true)
		setRequestResponseLogEnabled(t, true)

		body := callRequestResponseHandler(t, GetRequestResponseByLogId, 9, common.RoleAdminUser, "1", "")

		assert.Equal(t, true, body["success"])
		data, ok := body["data"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "a-1", data["request_id"])
		assert.Equal(t, "ok", data["response_body"])
		assert.NotContains(t, body, "code")
	})

	t.Run("answers success with no data when the record is missing", func(t *testing.T) {
		useRequestResponseLogData(t, true)
		setRequestResponseLogEnabled(t, true)

		body := callRequestResponseHandler(t, GetRequestResponseByLogId, 9, common.RoleAdminUser, "2", "")

		assert.Equal(t, true, body["success"])
		assert.Nil(t, body["data"])
		assert.NotContains(t, body, "code")
		assert.NotContains(t, body, "message_key")
	})

	t.Run("still returns stored bodies when recording was turned off", func(t *testing.T) {
		useRequestResponseLogData(t, true)
		setRequestResponseLogEnabled(t, false)

		body := callRequestResponseHandler(t, GetRequestResponseByLogId, 9, common.RoleAdminUser, "1", "")

		assert.Equal(t, true, body["success"])
		data, ok := body["data"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "a-1", data["request_id"])
	})

	t.Run("reports the disabled code when recording is off and nothing is stored", func(t *testing.T) {
		useRequestResponseLogData(t, true)
		setRequestResponseLogEnabled(t, false)

		body := callRequestResponseHandler(t, GetRequestResponseByLogId, 9, common.RoleAdminUser, "2", "")

		assert.Equal(t, false, body["success"])
		assert.Equal(t, "REQUEST_RESPONSE_RECORDING_DISABLED", body["code"])
		assert.Equal(t, disabledRecordingMessage, body["message"])
		assert.Equal(t, disabledRecordingMessage, body["message_key"])
	})

	t.Run("hides the missing-table error when recording is off", func(t *testing.T) {
		// 不迁移 request_response_logs 表：等价于 ClickHouse 日志库（表不存在），
		// 开关关闭时任何查询失败都必须答 disabled，且不能泄漏 SQL 错误。
		useRequestResponseLogData(t, false)
		setRequestResponseLogEnabled(t, false)

		body := callRequestResponseHandler(t, GetRequestResponseByLogId, 9, common.RoleAdminUser, "1", "")

		assert.Equal(t, false, body["success"])
		assert.Equal(t, "REQUEST_RESPONSE_RECORDING_DISABLED", body["code"])
		assert.Equal(t, disabledRecordingMessage, body["message"])
	})

	t.Run("reports a load failure for real database errors", func(t *testing.T) {
		// 开关开启且非 ClickHouse 时的查询失败是真实故障，不能被伪装成 disabled。
		useRequestResponseLogData(t, false)
		setRequestResponseLogEnabled(t, true)

		body := callRequestResponseHandler(t, GetRequestResponseByLogId, 9, common.RoleAdminUser, "1", "")

		assert.Equal(t, false, body["success"])
		assert.Equal(t, "Failed to load request/response data", body["message"])
		assert.NotContains(t, body, "code")
	})

	t.Run("keeps the existing not-found and invalid-id responses", func(t *testing.T) {
		useRequestResponseLogData(t, true)
		setRequestResponseLogEnabled(t, true)

		missing := callRequestResponseHandler(t, GetRequestResponseByLogId, 9, common.RoleAdminUser, "999", "")
		assert.Equal(t, false, missing["success"])
		// 管理员路径直接透出日志查询错误（既有行为，本次不改）。
		assert.Equal(t, "record not found", missing["message"])
		assert.NotContains(t, missing, "code")

		invalid := callRequestResponseHandler(t, GetRequestResponseByLogId, 9, common.RoleAdminUser, "abc", "")
		assert.Equal(t, false, invalid["success"])
		assert.Equal(t, "invalid log id", invalid["message"])
	})
}

func TestGetRequestResponseSelfRequestId(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("returns the stored bodies for the owner", func(t *testing.T) {
		useRequestResponseLogData(t, true)
		setRequestResponseLogEnabled(t, true)

		body := callRequestResponseHandler(t, GetRequestResponseSelfRequestId, 1, common.RoleCommonUser, "", "request_id=a-1")

		assert.Equal(t, true, body["success"])
		data, ok := body["data"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "a-1", data["request_id"])
	})

	t.Run("answers success with no data for the owner without a record", func(t *testing.T) {
		useRequestResponseLogData(t, true)
		setRequestResponseLogEnabled(t, true)

		body := callRequestResponseHandler(t, GetRequestResponseSelfRequestId, 1, common.RoleCommonUser, "", "request_id=a-2")

		assert.Equal(t, true, body["success"])
		assert.Nil(t, body["data"])
		assert.NotContains(t, body, "code")
	})

	t.Run("keeps stored bodies and reports the disabled code when recording is off", func(t *testing.T) {
		useRequestResponseLogData(t, true)

		setRequestResponseLogEnabled(t, false)
		stored := callRequestResponseHandler(t, GetRequestResponseSelfRequestId, 1, common.RoleCommonUser, "", "request_id=a-1")
		assert.Equal(t, true, stored["success"])
		data, ok := stored["data"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "a-1", data["request_id"])

		missing := callRequestResponseHandler(t, GetRequestResponseSelfRequestId, 1, common.RoleCommonUser, "", "request_id=a-2")
		assert.Equal(t, false, missing["success"])
		assert.Equal(t, "REQUEST_RESPONSE_RECORDING_DISABLED", missing["code"])
		assert.Equal(t, disabledRecordingMessage, missing["message"])
	})

	t.Run("keeps unauthorized lookups indistinguishable across switch states", func(t *testing.T) {
		// 越权探测防护：查看他人日志的响应在开关开/关两种状态下必须完全一致，
		// disabled code 不能成为判断他人日志是否存在的新通道。
		useRequestResponseLogData(t, true)

		setRequestResponseLogEnabled(t, true)
		enabled := callRequestResponseHandler(t, GetRequestResponseSelfRequestId, 1, common.RoleCommonUser, "", "request_id=b-1")
		setRequestResponseLogEnabled(t, false)
		disabled := callRequestResponseHandler(t, GetRequestResponseSelfRequestId, 1, common.RoleCommonUser, "", "request_id=b-1")

		assert.Equal(t, enabled, disabled)
		assert.Equal(t, false, enabled["success"])
		assert.Equal(t, "log not found", enabled["message"])
		assert.NotContains(t, enabled, "code")
		assert.NotContains(t, enabled, "message_key")
	})

	t.Run("requires the request_id parameter", func(t *testing.T) {
		useRequestResponseLogData(t, true)
		setRequestResponseLogEnabled(t, true)

		body := callRequestResponseHandler(t, GetRequestResponseSelfRequestId, 1, common.RoleCommonUser, "", "")

		assert.Equal(t, false, body["success"])
		assert.Equal(t, "request_id is required", body["message"])
	})

	t.Run("hides the missing-table error when recording is off", func(t *testing.T) {
		useRequestResponseLogData(t, false)
		setRequestResponseLogEnabled(t, false)

		body := callRequestResponseHandler(t, GetRequestResponseSelfRequestId, 1, common.RoleCommonUser, "", "request_id=a-1")

		assert.Equal(t, false, body["success"])
		assert.Equal(t, "REQUEST_RESPONSE_RECORDING_DISABLED", body["code"])
		assert.Equal(t, disabledRecordingMessage, body["message"])
	})
}
