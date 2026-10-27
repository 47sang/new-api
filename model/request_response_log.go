package model

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/tidwall/gjson"
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
	StatusCode int `json:"status_code"`
	// SessionId 会话标识：同一对话任务（含子代理分支）的每次请求携带同一个值，
	// 用于把分散的轮次还原成一整条对话线；空串表示该请求未携带会话标识
	SessionId string `json:"session_id" gorm:"type:varchar(64);index;default:''"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;index"`
}

// sessionIdMaxLen 与 SessionId 列的 varchar(64) 对齐：超长的值直接丢弃，
// 避免异常客户端把索引键撑到任意长度
const sessionIdMaxLen = 64

// claudeCodeSessionMeta 是 Claude Code 在 metadata.user_id 中携带的会话标识。
// user_id 是"字符串里套 JSON"：{"device_id":"…","account_uuid":"","session_id":"<UUID>"}，
// 因此必须先取出字符串再解析一次，不能按对象路径直接取 session_id
type claudeCodeSessionMeta struct {
	SessionId string `json:"session_id"`
}

// extractSessionId 从请求体提取会话标识。仅认 Claude Code 的结构化 metadata.user_id：
// 取出的值形如 JSON 对象文本时才解析，普通字符串（客户端自填的 user_id）不作为
// 会话标识——那标识的是终端用户而非对话，按它分组会把不同对话并成一条
func extractSessionId(requestBody string) string {
	if requestBody == "" {
		return ""
	}
	raw := gjson.Get(requestBody, "metadata.user_id")
	if !raw.Exists() {
		return ""
	}
	value := strings.TrimSpace(raw.String())
	if !strings.HasPrefix(value, "{") {
		return ""
	}
	var meta claudeCodeSessionMeta
	if err := common.UnmarshalJsonStr(value, &meta); err != nil {
		return ""
	}
	meta.SessionId = strings.TrimSpace(meta.SessionId)
	if meta.SessionId == "" || len(meta.SessionId) > sessionIdMaxLen {
		return ""
	}
	return meta.SessionId
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
		SessionId:    extractSessionId(requestBody),
		CreatedAt:    common.GetTimestamp(),
	}

	if err := LOG_DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "request_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"request_body", "response_body", "is_stream", "is_completed",
			"response_size", "status_code", "session_id", "created_at",
		}),
	}).Create(log).Error; err != nil {
		common.SysErrorThrottled("failed to save request/response log: " + err.Error())
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

// sessionTurnQueryLimit 限制单次会话查询返回的轮次数：一条会话线可能包含数百次
// 请求（含子代理分支），全部返回既无必要也会把响应体撑大
const sessionTurnQueryLimit = 200

// GetRequestResponseLogsBySessionId 查询同一会话的全部轮次，按时间正序返回。
// 会话标识是客户端显式携带的，不需要推断；查不到就是空列表
func GetRequestResponseLogsBySessionId(sessionId string) ([]*RequestResponseLog, error) {
	if sessionId == "" {
		return nil, nil
	}
	var logs []*RequestResponseLog
	err := LOG_DB.Where("session_id = ?", sessionId).
		Order("created_at asc, id asc").
		Limit(sessionTurnQueryLimit).
		Find(&logs).Error
	if err != nil {
		return nil, err
	}
	return logs, nil
}

// CountRequestResponseLogsMissingSessionId 统计尚未回填 session_id 的行数，
// 供回填接口向管理员报告剩余工作量
func CountRequestResponseLogsMissingSessionId() (int64, error) {
	var count int64
	err := LOG_DB.Model(&RequestResponseLog{}).
		Where("session_id = '' OR session_id IS NULL").
		Count(&count).Error
	return count, err
}

// BackfillRequestResponseLogSessionIds 为功能上线前写入的历史行补填 session_id，
// 返回 (扫描行数, 实际更新行数)。按主键游标分批推进，批内按 session_id 分组批量更新，
// 避免逐行 UPDATE 在大表上形成大量小事务。
// 请求体里没有会话标识的行保持空串，不会被反复选中（下次回填直接跳过）
func BackfillRequestResponseLogSessionIds(batchSize int) (int64, int64, error) {
	if batchSize <= 0 {
		batchSize = 200
	}
	var scanned, updated int64
	var lastId int64
	for {
		var rows []RequestResponseLog
		if err := LOG_DB.Select("id", "request_body").
			Where("(session_id = '' OR session_id IS NULL) AND id > ?", lastId).
			Order("id asc").
			Limit(batchSize).
			Find(&rows).Error; err != nil {
			return scanned, updated, err
		}
		if len(rows) == 0 {
			return scanned, updated, nil
		}

		// 同一批里同一会话的多行合并成一次 UPDATE
		idsBySession := make(map[string][]int64)
		for i := range rows {
			scanned++
			lastId = rows[i].Id
			if sessionId := extractSessionId(rows[i].RequestBody); sessionId != "" {
				idsBySession[sessionId] = append(idsBySession[sessionId], rows[i].Id)
			}
		}
		for sessionId, ids := range idsBySession {
			if err := LOG_DB.Model(&RequestResponseLog{}).
				Where("id IN ?", ids).
				Update("session_id", sessionId).Error; err != nil {
				return scanned, updated, err
			}
			updated += int64(len(ids))
		}

		if len(rows) < batchSize {
			return scanned, updated, nil
		}
	}
}

// requestResponseLogCleanupBatchSize 限制保留期清理的单批删除行数。
// 单行可能达到数百 KB（完整请求体 + 响应体），一次删太多会把写锁握住很久，
// 阻塞同库的日志记录与额度批量更新，曾经造成全站写入 SQLITE_BUSY。
const requestResponseLogCleanupBatchSize = 100

// CleanupOldRequestResponseLogs 删除保留天数之前的请求/响应日志，返回删除行数。
// 分批删除：每批独立事务、批间释放写锁，避免长事务把其他写入堵死；
// 删完（本批不足一批）即返回。retentionDays 为 0 表示永久保留。
func CleanupOldRequestResponseLogs(retentionDays int) (int64, error) {
	if retentionDays <= 0 {
		return 0, nil // 0 表示永久保留
	}

	cutoffTimestamp := time.Now().AddDate(0, 0, -retentionDays).Unix()
	var total int64
	for {
		deleted, err := DeleteOldRequestResponseLogBatch(context.Background(), cutoffTimestamp, requestResponseLogCleanupBatchSize)
		if err != nil {
			return total, err
		}
		total += deleted
		if deleted < requestResponseLogCleanupBatchSize {
			return total, nil
		}
	}
}

// DeleteOldRequestResponseLogBatch 分批删除指定时间戳之前创建的请求/响应日志，
// 供手动清理历史日志的系统任务联动调用：logs 表与 request_response_logs 仅靠
// request_id 逻辑关联、无外键级联，清理 logs 时若不同步删除会留下孤儿大文本。
// 两表 created_at 同源（均为请求时刻），按同一目标时间戳删除即可联动。
//
// ⚠️ 不能写成 Where(...).Limit(limit).Delete(...)：GORM 的 Delete 语句不渲染 LIMIT
// （删除子句只有 DELETE/FROM/WHERE），那样会把时间范围内的行一次性全部删除，形成一个
// 巨型长事务——在数 GB 的表上会长时间独占写锁，把同库写入全部堵成 SQLITE_BUSY。
// 因此先按 created_at 取出本批次主键，再按主键删除：三种数据库都支持，也真正分批。
func DeleteOldRequestResponseLogBatch(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	if limit <= 0 {
		limit = 100
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}

	var ids []int64
	if err := LOG_DB.WithContext(ctx).Model(&RequestResponseLog{}).
		Where("created_at < ?", targetTimestamp).
		Order("created_at asc, id asc").
		Limit(limit).
		Pluck("id", &ids).Error; err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}

	result := LOG_DB.WithContext(ctx).Where("id IN ?", ids).Delete(&RequestResponseLog{})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}

// StartRequestResponseLogCleanup 启动定期清理过期请求/响应日志的 goroutine（常驻）
// 保留期不通过参数传入，而是每轮现读 common.RequestResponseLogRetentionDays：
// 管理员在系统设置里改保留期后，下一个 tick 即按新值生效，无需重启。
// 保留期为 0（永久保留）时该轮跳过；从 0 改成有限天数同样无需重启即可开始清理。
func StartRequestResponseLogCleanup() {
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()

		// 启动后先清理一次
		cleanupRequestResponseLogs()

		for range ticker.C {
			cleanupRequestResponseLogs()
		}
	}()
}

// cleanupMu 保证同一时刻只有一个清理在跑；cleanupPending 记录「清理期间又来了新触发」。
// 只用 TryLock 会在清理在跑时悄悄丢弃触发——丢弃后新的保留期要等最多 24 小时的下一个
// tick 才生效，因此跑完当前轮后必须补跑一次。
var (
	cleanupMu      sync.Mutex
	cleanupPending atomic.Bool
)

// TriggerRequestResponseLogCleanupAsync 异步执行一次保留期清理，供管理员修改保留期后
// 立即生效（否则要等最多 24 小时的下一个 tick）。已有清理在跑时登记待办，由那一轮
// 跑完后补跑，不叠加也不丢弃。启动时的选项加载不走这条路，避免与启动清理重复。
func TriggerRequestResponseLogCleanupAsync() {
	if !cleanupMu.TryLock() {
		cleanupPending.Store(true)
		return
	}
	go runRequestResponseLogCleanup()
}

// runRequestResponseLogCleanup 执行清理；若执行期间又有新触发进来，按新触发再跑一轮
func runRequestResponseLogCleanup() {
	defer cleanupMu.Unlock()
	for {
		cleanupPending.Store(false)
		cleanupRequestResponseLogs()
		if !cleanupPending.Load() {
			return
		}
	}
}

// cleanupRequestResponseLogs 删除过期请求/响应日志。
// 保留期清理只受保留期控制，**不受功能开关控制**：关闭开关只是停止记录，
// 若同时停止清理，存量数据会永久堆积（线上曾出现开关关闭两周、1GB 数据一天未清）。
// ClickHouse 日志库没有迁移该表，直接跳过以免每次清理都报错。
func cleanupRequestResponseLogs() {
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		return
	}
	retentionDays := common.RequestResponseLogRetentionDays
	if retentionDays <= 0 {
		return // 0 = 永久保留
	}
	deleted, err := CleanupOldRequestResponseLogs(retentionDays)
	if err != nil {
		common.SysError("failed to cleanup request/response logs: " + err.Error())
	} else if deleted > 0 {
		common.SysLog("cleaned up " + strconv.FormatInt(deleted, 10) + " expired request/response log(s)")
	}
}
