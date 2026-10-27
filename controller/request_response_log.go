package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// GetRequestResponseByLogId 根据日志 ID 获取请求/响应详情
// 管理员及以上可查看所有，普通用户只能查看自己的（/self 路由同样进入本 handler，由角色区分）
func GetRequestResponseByLogId(c *gin.Context) {
	logId, err := strconv.Atoi(c.Param("id"))
	if err != nil || logId <= 0 {
		common.ApiError(c, errors.New("invalid log id"))
		return
	}

	// 先根据 logId 从 logs 表获取 request_id
	log, logErr := model.GetLogById(logId)

	// 权限检查：普通用户只能查看自己的日志。
	// 对无权访问的日志统一返回 not found，避免通过不同错误消息探测其他用户日志的存在性
	userRole := c.GetInt("role")
	if userRole < common.RoleAdminUser {
		currentUserId := c.GetInt("id")
		if logErr != nil || log.UserId != currentUserId {
			common.ApiError(c, errors.New("log not found"))
			return
		}
	} else if logErr != nil {
		common.ApiError(c, logErr)
		return
	}

	if log.RequestId == "" {
		common.ApiError(c, errors.New("no request id associated with this log"))
		return
	}

	// 从新表获取请求/响应数据
	respondRequestResponseLog(c, log.RequestId)
}

// GetRequestResponseSession 查询同一会话的全部轮次，把一次对话任务的多次请求
// 还原成完整对话线。会话标识由客户端显式携带（Claude Code 的 metadata.user_id.session_id），
// 服务端不做推断。
// 普通用户只能看自己的轮次：按 user_id 过滤后结果为空时统一返回 not found，
// 避免通过不同错误消息探测他人会话的存在性
func GetRequestResponseSession(c *gin.Context) {
	sessionId := strings.TrimSpace(c.Query("session_id"))
	if sessionId == "" {
		common.ApiError(c, errors.New("session_id is required"))
		return
	}

	isAdmin := c.GetInt("role") >= common.RoleAdminUser
	userId := 0
	if !isAdmin {
		userId = c.GetInt("id")
	}

	logs, err := model.GetLogsBySessionId(sessionId, userId, 0)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(logs) == 0 {
		common.ApiError(c, errors.New("session not found"))
		return
	}

	if !isAdmin {
		model.FormatLogsForUser(logs)
	}

	common.ApiSuccess(c, gin.H{
		"session_id": sessionId,
		"total":      len(logs),
		"turns":      logs,
	})
}

// BackfillRequestResponseSession 为功能上线前写入的历史行补填 session_id（管理员）。
// 分批推进并返回剩余量，管理员可重复调用直至 remaining 为 0
func BackfillRequestResponseSession(c *gin.Context) {
	batchSize := 200
	if raw := strings.TrimSpace(c.Query("batch_size")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			common.ApiError(c, errors.New("invalid batch_size"))
			return
		}
		batchSize = min(parsed, 1000)
	}

	scanned, updated, err := model.BackfillRequestResponseLogSessionIds(batchSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	remaining, err := model.CountRequestResponseLogsMissingSessionId()
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{
		"scanned":   scanned,
		"updated":   updated,
		"remaining": remaining,
	})
}

// GetRequestResponseSelfRequestId 普通用户查看自己的请求/响应详情。
// 用户侧日志列表返回的 id 是合成展示 id（startIdx+i），不能作为查询键，
// 因此本端点以 request_id（用户侧列表每行携带的真实字段）为查询键，
// 并通过 logs 表的 (request_id, user_id) 归属校验防止越权；
// 对无权访问的记录统一返回 not found，避免探测其他用户日志的存在性
func GetRequestResponseSelfRequestId(c *gin.Context) {
	requestId := c.Query("request_id")
	if requestId == "" {
		common.ApiError(c, errors.New("request_id is required"))
		return
	}

	owned, err := model.HasUserLogByRequestId(requestId, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !owned {
		common.ApiError(c, errors.New("log not found"))
		return
	}

	respondRequestResponseLog(c, requestId)
}

// respondRequestResponseLog 查询并返回 request_id 对应的请求/响应记录。
// 查询不到不是错误：保留期清理掉、ClickHouse 日志库未迁移该表、开关关闭时未记录，
// 都是合法答案；存量记录即使开关已关闭仍可查看，因此查询必须先于开关判定。
func respondRequestResponseLog(c *gin.Context, requestId string) {
	reqRespLog, reqErr := model.GetRequestResponseLogByRequestId(requestId)
	switch {
	case reqErr == nil:
		common.ApiSuccess(c, reqRespLog)
	case !common.RequestResponseLogEnabled || common.UsingLogDatabase(common.DatabaseTypeClickHouse):
		// 功能关闭（含 ClickHouse 日志库没有该表）时任何查询失败都按「未开启」作答，
		// 不透出底层库错误；稳定 code 让前端展示友好提示而不是报错。
		common.ApiErrorStatus(c, http.StatusOK,
			common.NewMessage("Request/response recording is disabled. Enable it to view the input/output message details."),
			gin.H{"code": "REQUEST_RESPONSE_RECORDING_DISABLED"})
	case errors.Is(reqErr, gorm.ErrRecordNotFound):
		common.ApiSuccess(c, nil)
	default:
		common.ApiErrorT(c, "Failed to load request/response data")
	}
}
