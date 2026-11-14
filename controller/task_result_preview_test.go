package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetDashboardTaskResultPreviewReturnsUpstreamURLForOwner(t *testing.T) {
	task := setupGenericTaskTest(t)
	task.Status = model.TaskStatusSuccess
	task.PrivateData.ResultURL = "https://cdn.example/video.mp4?signature=secret"
	require.NoError(t, model.DB.Save(task).Error)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", task.UserId)
	c.Set("role", common.RoleCommonUser)
	c.Params = gin.Params{{Key: "task_id", Value: task.TaskID}}
	c.Request = httptest.NewRequest(http.MethodGet, "/api/task/"+task.TaskID+"/result-preview", nil)

	GetDashboardTaskResultPreview(c)

	require.Equal(t, http.StatusOK, recorder.Code)
	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			TaskID    string `json:"task_id"`
			Status    string `json:"status"`
			ResultURL string `json:"result_url"`
			Format    string `json:"format"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &envelope))
	assert.True(t, envelope.Success)
	assert.Equal(t, task.TaskID, envelope.Data.TaskID)
	assert.Equal(t, string(model.TaskStatusSuccess), envelope.Data.Status)
	assert.Equal(t, "https://cdn.example/video.mp4?signature=secret", envelope.Data.ResultURL)
	assert.Equal(t, "mp4", envelope.Data.Format)
}

func TestGetDashboardTaskResultPreviewHidesURLUntilSuccess(t *testing.T) {
	task := setupGenericTaskTest(t)
	task.Status = model.TaskStatusInProgress
	task.Progress = "30%"
	task.PrivateData.ResultURL = "https://cdn.example/early.mp4"
	require.NoError(t, model.DB.Save(task).Error)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", task.UserId)
	c.Set("role", common.RoleCommonUser)
	c.Params = gin.Params{{Key: "task_id", Value: task.TaskID}}
	c.Request = httptest.NewRequest(http.MethodGet, "/api/task/"+task.TaskID+"/result-preview", nil)

	GetDashboardTaskResultPreview(c)

	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"status":"IN_PROGRESS"`)
	assert.NotContains(t, recorder.Body.String(), "result_url")
	assert.NotContains(t, recorder.Body.String(), "cdn.example")
}

func TestGetDashboardTaskResultPreviewRejectsOtherUser(t *testing.T) {
	task := setupGenericTaskTest(t)
	task.PrivateData.ResultURL = "https://cdn.example/private.mp4"
	require.NoError(t, model.DB.Save(task).Error)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", task.UserId+1)
	c.Set("role", common.RoleCommonUser)
	c.Params = gin.Params{{Key: "task_id", Value: task.TaskID}}
	c.Request = httptest.NewRequest(http.MethodGet, "/api/task/"+task.TaskID+"/result-preview", nil)

	GetDashboardTaskResultPreview(c)

	assert.Equal(t, http.StatusNotFound, recorder.Code)
	assert.NotContains(t, recorder.Body.String(), "cdn.example")
}

func TestGetDashboardTaskResultPreviewAllowsAdmin(t *testing.T) {
	task := setupGenericTaskTest(t)
	task.Status = model.TaskStatusSuccess
	task.PrivateData.ResultURL = "https://cdn.example/admin-view.webm"
	require.NoError(t, model.DB.Save(task).Error)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", 1)
	c.Set("role", common.RoleAdminUser)
	c.Set("token_id", 0)
	c.Params = gin.Params{{Key: "task_id", Value: task.TaskID}}
	c.Request = httptest.NewRequest(http.MethodGet, "/api/task/"+task.TaskID+"/result-preview", nil)

	GetDashboardTaskResultPreview(c)

	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "admin-view.webm")
	assert.Contains(t, recorder.Body.String(), `"format":"webm"`)
}

func TestGetDashboardTaskResultPreviewOmitsDiscardedResults(t *testing.T) {
	task := setupGenericTaskTest(t)
	task.Status = model.TaskStatusSuccess
	task.PrivateData.ResultURL = "https://cdn.example/discarded.mp4"
	task.PrivateData.ResultDiscarded = true
	require.NoError(t, model.DB.Save(task).Error)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", task.UserId)
	c.Set("role", common.RoleCommonUser)
	c.Params = gin.Params{{Key: "task_id", Value: task.TaskID}}
	c.Request = httptest.NewRequest(http.MethodGet, "/api/task/"+task.TaskID+"/result-preview", nil)

	GetDashboardTaskResultPreview(c)

	assert.Equal(t, http.StatusNotFound, recorder.Code)
	assert.NotContains(t, recorder.Body.String(), "cdn.example")
}
