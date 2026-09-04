package controller

import (
	"errors"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
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
	reqRespLog, reqErr := model.GetRequestResponseLogByRequestId(log.RequestId)
	if reqErr != nil {
		common.ApiError(c, errors.New("request/response log not found"))
		return
	}

	common.ApiSuccess(c, reqRespLog)
}

// GetRequestResponseSelfByLogId 普通用户查看自己的请求/响应详情
func GetRequestResponseSelfByLogId(c *gin.Context) {
	GetRequestResponseByLogId(c)
}
