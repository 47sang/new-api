package controller

import (
	"errors"
	"net/http"
	"strconv"

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
