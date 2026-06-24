package model

import (
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// RequestResponseLog 存储请求和响应的完整内容，通过 request_id 与 logs 表关联
type RequestResponseLog struct {
	Id          int64  `json:"id" gorm:"primaryKey;autoIncrement;index"`
	RequestId   string `json:"request_id" gorm:"type:varchar(64);uniqueIndex;not null;index:idx_req_log_created"`
	RequestBody string `json:"request_body" gorm:"type:MEDIUMTEXT"`
	// 非流式响应：存储完整响应体；流式响应：留空
	ResponseBody string `json:"response_body" gorm:"type:MEDIUMTEXT"`
	// IsCompleted 标记响应是否已完整接收（非流式=true，流式=false）
	IsCompleted bool `json:"is_completed" gorm:"default:true"`
	// ResponseSize 响应体字节大小，0 表示无响应体（流式或错误）
	ResponseSize int `json:"response_size" gorm:"default:0"`
	// StatusCode HTTP 状态码，0 表示未设置
	StatusCode int `json:"status_code" gorm:"default:0"`
	CreatedAt  int64 `json:"created_at" gorm:"bigint;index:idx_req_log_created"`
}

func (RequestResponseLog) TableName() string {
	return "request_response_logs"
}

// SaveRequestResponseLog 保存请求/响应日志（异步调用，内部不做权限校验）
func SaveRequestResponseLog(requestId string, requestBody string, responseBody string, isCompleted bool, responseSize int, statusCode int) {
	if !common.RequestResponseLogEnabled {
		return
	}
	if requestId == "" {
		return
	}

	// 限制响应体大小：最大 2MB，超出截断
	const maxResponseBodySize = 2 * 1024 * 1024
	if len(responseBody) > maxResponseBodySize {
		responseBody = responseBody[:maxResponseBodySize] + "\n... [truncated, exceeds 2MB limit]"
	}

	log := &RequestResponseLog{
		RequestId:     requestId,
		RequestBody:   requestBody,
		ResponseBody:  responseBody,
		IsCompleted:   isCompleted,
		ResponseSize:  responseSize,
		StatusCode:    statusCode,
		CreatedAt:     common.GetTimestamp(),
	}

	if err := LOG_DB.Create(log).Error; err != nil {
		common.SysLog("failed to save request/response log: " + err.Error())
	}
}

// GetRequestResponseLogByRequestId 根据 request_id 查询请求/响应日志
func GetRequestResponseLogByRequestId(requestId string) (*RequestResponseLog, error) {
	if requestId == "" {
		return nil, gorm.ErrRecordNotFound
	}
	var log RequestResponseLog
	err := LOG_DB.Where("request_id = ?", requestId).First(&log).Error
	if err != nil {
		return nil, err
	}
	return &log, nil
}

// CleanupOldRequestResponseLogs 清理过期的请求/响应日志
// retentionDays: 保留天数，0 表示永久保留
func CleanupOldRequestResponseLogs(retentionDays int) (int64, error) {
	if retentionDays <= 0 {
		return 0, nil // 0 表示永久保留
	}

	cutoffTimestamp := time.Now().AddDate(0, 0, -retentionDays).Unix()
	result := LOG_DB.Where("created_at < ?", cutoffTimestamp).Delete(&RequestResponseLog{})
	return result.RowsAffected, result.Error
}

// StartRequestResponseLogCleanup 启动定期清理过期请求/响应日志的 goroutine
// retentionDays: 保留天数，0 表示永久保留（不清理）
// interval: 清理间隔，默认 24 小时
func StartRequestResponseLogCleanup(retentionDays int) {
	if retentionDays <= 0 {
		common.SysLog("request/response log cleanup disabled (retention days = 0)")
		return
	}

	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()

		// 启动后先清理一次
		cleanupRequestResponseLogs(retentionDays)

		for range ticker.C {
			cleanupRequestResponseLogs(retentionDays)
		}
	}()
}

func cleanupRequestResponseLogs(retentionDays int) {
	deleted, err := CleanupOldRequestResponseLogs(retentionDays)
	if err != nil {
		common.SysError("failed to cleanup request/response logs: " + err.Error())
	} else if deleted > 0 {
		common.SysLog("cleaned up " + strconv.FormatInt(deleted, 10) + " expired request/response log(s)")
	}
}
