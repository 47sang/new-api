package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// GetRequestResponseByLogId 根据日志 ID 获取请求/响应详情
// 管理员可查看所有，普通用户只能查看自己的
func GetRequestResponseByLogId(c *gin.Context) {
	logId, err := strconv.Atoi(c.Param("id"))
	if err != nil || logId <= 0 {
		common.ApiError(c, types.NewErrorWithStatusCode(
			errors.New("invalid log id"), types.ErrorCodeInvalidRequest, http.StatusBadRequest,
		))
		return
	}

	// 先根据 logId 从 logs 表获取 request_id
	log, logErr := model.GetLogById(logId)
	if logErr != nil {
		common.ApiError(c, types.NewErrorWithStatusCode(
			logErr, types.ErrorCodeQueryDataError, http.StatusNotFound,
		))
		return
	}

	if log.RequestId == "" {
		common.ApiError(c, types.NewErrorWithStatusCode(
			errors.New("no request id associated with this log"), types.ErrorCodeQueryDataError, http.StatusNotFound,
		))
		return
	}

	// 权限检查：普通用户只能查看自己的日志
	userRole := c.GetInt("role")
	if userRole != common.RoleAdminUser {
		currentUserId := c.GetInt("id")
		if log.UserId != currentUserId {
			common.ApiError(c, types.NewErrorWithStatusCode(
				errors.New("access denied"), types.ErrorCodeAccessDenied, http.StatusForbidden,
			))
			return
		}
	}

	// 从新表获取请求/响应数据
	reqRespLog, reqErr := model.GetRequestResponseLogByRequestId(log.RequestId)
	if reqErr != nil {
		common.ApiError(c, types.NewErrorWithStatusCode(
			reqErr, types.ErrorCodeQueryDataError, http.StatusNotFound,
		))
		return
	}

	common.ApiSuccess(c, reqRespLog)
}

// GetRequestResponseSelfByLogId 普通用户查看自己的请求/响应详情
func GetRequestResponseSelfByLogId(c *gin.Context) {
	GetRequestResponseByLogId(c)
}
