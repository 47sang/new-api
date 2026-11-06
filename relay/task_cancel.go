package relay

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// upstreamCanceller is implemented by task plugins that can cancel a queued
// vendor task. Running tasks must not be sent here: some vendors reuse the
// request to delete finished records.
type upstreamCanceller interface {
	CancelUpstream(baseURL, key string, task *model.Task, proxy string) (*http.Response, error)
}

// RelayVideoCancel cancels a video task that has not entered upstream generation.
// Queued (or not yet submitted) tasks are cancelled and the pre-charge is refunded.
// A task the vendor already reports as running is left untouched.
func RelayVideoCancel(c *gin.Context) *dto.TaskError {
	taskID := c.Param("task_id")
	userID := c.GetInt("id")
	task, exist, err := model.GetByTaskId(userID, taskID)
	if err != nil {
		return service.TaskErrorWrapper(err, "get_task_failed", http.StatusInternalServerError)
	}
	if !exist {
		return service.TaskErrorWrapperLocal(errString("task_not_exist"), "task_not_exist", http.StatusBadRequest)
	}
	if task.Status == model.TaskStatusFailure && task.FailReason == "cancelled" {
		c.JSON(http.StatusOK, gin.H{"status": "cancelled"})
		return nil
	}
	if task.Status == model.TaskStatusSuccess || task.Status == model.TaskStatusFailure {
		return service.TaskErrorWrapperLocal(errString("already_finished"), "already_finished", http.StatusConflict)
	}

	adaptor := GetTaskAdaptor(task.Platform)
	if adaptor == nil {
		return service.TaskErrorWrapperLocal(errString("invalid_channel"), "invalid_channel", http.StatusBadRequest)
	}
	ch, err := model.CacheGetChannel(task.ChannelId)
	if err != nil {
		return service.TaskErrorWrapper(err, "get_channel_failed", http.StatusInternalServerError)
	}
	baseURL := constant.GetChannelBaseURL(ch.Type)
	if ch.GetBaseURL() != "" {
		baseURL = ch.GetBaseURL()
	}
	proxy := ch.GetSetting().Proxy
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ChannelType:    ch.Type,
		ChannelId:      ch.Id,
		ChannelBaseUrl: baseURL,
		ChannelSetting: ch.GetSetting(),
	}}
	info.ApiKey = ch.Key
	adaptor.Init(info)

	// 还没拿到上游任务号：请求没发出去，只终态本地任务并退预扣。
	if task.PrivateData.UpstreamTaskID == "" {
		if !queuedFamily(task.Status) {
			return service.TaskErrorWrapperLocal(errString("generation_started"), "generation_started", http.StatusConflict)
		}
		return finishVideoCancel(c, task)
	}

	live, liveErr := liveUpstreamStatus(adaptor, baseURL, ch.Key, task, proxy)
	if liveErr != nil {
		return liveErr
	}
	switch {
	case live == model.TaskStatusInProgress:
		return service.TaskErrorWrapperLocal(errString("generation_started"), "generation_started", http.StatusConflict)
	case live == model.TaskStatusSuccess || live == model.TaskStatusFailure:
		return service.TaskErrorWrapperLocal(errString("already_finished"), "already_finished", http.StatusConflict)
	case !queuedFamily(live):
		return service.TaskErrorWrapperLocal(errString("generation_started"), "generation_started", http.StatusConflict)
	}

	canceller, ok := adaptor.(upstreamCanceller)
	if !ok {
		return service.TaskErrorWrapperLocal(errString("cancel_unsupported"), "cancel_unsupported", http.StatusNotImplemented)
	}
	resp, err := canceller.CancelUpstream(baseURL, ch.Key, task, proxy)
	if err != nil {
		logger.LogWarn(c.Request.Context(), "video cancel upstream failed task=%s err=%s", task.TaskID, err.Error())
		return service.TaskErrorWrapper(err, "cancel_upstream_failed", http.StatusBadGateway)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return service.TaskErrorWrapper(err, "cancel_upstream_failed", http.StatusBadGateway)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		logger.LogWarn(c.Request.Context(), "video cancel upstream rejected task=%s http=%d", task.TaskID, resp.StatusCode)
		if resp.StatusCode >= 500 {
			return service.TaskErrorWrapperLocal(errString("cancel_upstream_failed"), "cancel_upstream_failed", http.StatusBadGateway)
		}
		return service.TaskErrorWrapperLocal(errString("generation_started"), "generation_started", http.StatusConflict)
	}
	if code := cancelBodyRejects(body); code != "" {
		status := http.StatusConflict
		return service.TaskErrorWrapperLocal(errString(code), code, status)
	}
	return finishVideoCancel(c, task)
}

func finishVideoCancel(c *gin.Context, task *model.Task) *dto.TaskError {
	from := task.Status
	now := time.Now().Unix()
	task.Status = model.TaskStatusFailure
	task.FailReason = "cancelled"
	task.Progress = taskcommon.ProgressComplete
	if task.FinishTime == 0 {
		task.FinishTime = now
	}
	won, err := task.UpdateWithStatus(from)
	if err != nil {
		return service.TaskErrorWrapper(err, "update_task_failed", http.StatusInternalServerError)
	}
	if won {
		service.RefundTaskQuota(c.Request.Context(), task, "cancelled")
		c.JSON(http.StatusOK, gin.H{"status": "cancelled"})
		return nil
	}
	reloaded, exist, err := model.GetByTaskId(task.UserId, task.TaskID)
	if err != nil {
		return service.TaskErrorWrapper(err, "get_task_failed", http.StatusInternalServerError)
	}
	if exist && reloaded.Status == model.TaskStatusFailure && reloaded.FailReason == "cancelled" {
		c.JSON(http.StatusOK, gin.H{"status": "cancelled"})
		return nil
	}
	return service.TaskErrorWrapperLocal(errString("already_finished"), "already_finished", http.StatusConflict)
}

func liveUpstreamStatus(adaptor channel.TaskAdaptor, baseURL, key string, task *model.Task, proxy string) (model.TaskStatus, *dto.TaskError) {
	resp, err := adaptor.FetchTask(baseURL, key, task, proxy)
	if err != nil {
		return "", service.TaskErrorWrapper(err, "fetch_task_failed", http.StatusBadGateway)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", service.TaskErrorWrapper(err, "fetch_task_failed", http.StatusBadGateway)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", service.TaskErrorWrapperLocal(errString("fetch_task_failed"), "fetch_task_failed", http.StatusBadGateway)
	}
	parsed, err := adaptor.ParseTaskResult(task, resp, body)
	if err != nil || parsed == nil || parsed.Status == "" {
		return "", service.TaskErrorWrapperLocal(errString("fetch_task_failed"), "fetch_task_failed", http.StatusBadGateway)
	}
	return model.TaskStatus(parsed.Status), nil
}

func queuedFamily(status model.TaskStatus) bool {
	switch status {
	case model.TaskStatusNotStart, model.TaskStatusSubmitted, model.TaskStatusQueued:
		return true
	default:
		return false
	}
}

// cancelBodyRejects notices a 2xx body that is not a queued-task cancel.
// MiniMax uses one DELETE for both cancel and record deletion; a deleted
// record means the task was already finished.
func cancelBodyRejects(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil || payload == nil {
		return ""
	}
	if action, _ := payload["action"].(string); strings.EqualFold(action, "deleted") {
		return "already_finished"
	}
	if output, _ := payload["output"].(map[string]any); output != nil {
		if taskStatus, _ := output["task_status"].(string); strings.EqualFold(taskStatus, "RUNNING") {
			return "generation_started"
		}
	}
	return ""
}

type errString string

func (e errString) Error() string { return string(e) }
