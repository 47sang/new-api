package model

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// RequestResponseLog 存储请求和响应的完整内容，通过 request_id 与 logs 表关联
// 每次请求最终只保留一行：流式响应的分片在内存累积，请求结束后 UPSERT 一次落库
type RequestResponseLog struct {
	Id        int64  `json:"id" gorm:"primaryKey;autoIncrement;index"`
	RequestId string `json:"request_id" gorm:"type:varchar(64);uniqueIndex;not null"`
	// 大文本列不加 type 标签：GORM 在 MySQL 上映射为 LONGTEXT，PostgreSQL/SQLite 上映射为 TEXT
	RequestBody string `json:"request_body"`
	// 非流式响应：完整响应体；流式响应：分片合并后的单个最终响应对象（JSON），
	// 未识别的流式格式保留原始 SSE 报文；二进制响应：留空
	ResponseBody string `json:"response_body"`
	// IsStream 标记响应是否为流式（SSE）
	IsStream bool `json:"is_stream"`
	// IsCompleted 标记响应是否完整捕获（流式正常结束或非流式完整响应=true，客户端中断或二进制响应=false）
	IsCompleted bool `json:"is_completed"`
	// ResponseSize 响应体字节大小（流式为客户端实际收到的原始 SSE 报文大小），0 表示无响应体（二进制响应）
	ResponseSize int `json:"response_size"`
	// StatusCode HTTP 状态码，0 表示未设置
	StatusCode int   `json:"status_code"`
	CreatedAt  int64 `json:"created_at" gorm:"bigint;index"`
}

func (RequestResponseLog) TableName() string {
	return "request_response_logs"
}

// SaveRequestResponseLog 保存请求/响应日志（异步调用，内部不做权限校验）
// 按 request_id UPSERT：同一请求重复写入时覆盖旧记录，保证每请求一行
func SaveRequestResponseLog(requestId string, requestBody string, responseBody string, isStream bool, isCompleted bool, responseSize int, statusCode int) {
	if !common.RequestResponseLogEnabled {
		return
	}
	if requestId == "" {
		return
	}

	// 净化非法 UTF-8 序列：MySQL（utf8mb4 严格模式）/PostgreSQL 会拒绝含非法字节的写入，
	// 替换为 U+FFFD 以保证三种数据库行为一致
	requestBody = strings.ToValidUTF8(requestBody, "�")
	responseBody = strings.ToValidUTF8(responseBody, "�")

	log := &RequestResponseLog{
		RequestId:    requestId,
		RequestBody:  requestBody,
		ResponseBody: responseBody,
		IsStream:     isStream,
		IsCompleted:  isCompleted,
		ResponseSize: responseSize,
		StatusCode:   statusCode,
		CreatedAt:    common.GetTimestamp(),
	}

	if err := LOG_DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "request_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"request_body", "response_body", "is_stream", "is_completed",
			"response_size", "status_code", "created_at",
		}),
	}).Create(log).Error; err != nil {
		common.SysError("failed to save request/response log: " + err.Error())
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

// HasUserLogByRequestId 校验指定 request_id 的日志是否属于该用户，
// 用于普通用户请求/响应详情的归属检查（logs 表 request_id 已建索引）
func HasUserLogByRequestId(requestId string, userId int) (bool, error) {
	if requestId == "" {
		return false, nil
	}
	var existing Log
	err := LOG_DB.Select("id").
		Where("request_id = ? AND user_id = ?", requestId, userId).
		First(&existing).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
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

// StartRequestResponseLogCleanup 启动定期清理过期请求/响应日志的 goroutine（常驻）
// retentionDays: 保留天数，0 表示永久保留（不清理）
// 每次执行前检查功能开关：功能关闭时跳过，运行时开启后无需重启即可生效
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
	if !common.RequestResponseLogEnabled {
		return
	}
	deleted, err := CleanupOldRequestResponseLogs(retentionDays)
	if err != nil {
		common.SysError("failed to cleanup request/response logs: " + err.Error())
	} else if deleted > 0 {
		common.SysLog("cleaned up " + strconv.FormatInt(deleted, 10) + " expired request/response log(s)")
	}
}
