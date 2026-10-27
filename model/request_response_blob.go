package model

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/tidwall/gjson"
	"gorm.io/gorm/clause"
)

// RequestResponseBlob 存储从请求体中抽离的大块 base64 载荷，按内容 SHA-256 去重。
//
// agent 循环会把同一张截图每一轮重发：线上实测 480 个图片实例实际只有 17 张
// 不同的图，占请求体 39% 的字节。按内容寻址后同一载荷只存一份，读取时还原。
type RequestResponseBlob struct {
	Sha256    string `json:"sha256" gorm:"type:varchar(64);primaryKey"`
	Data      string `json:"data"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;index"`
}

func (RequestResponseBlob) TableName() string {
	return "request_response_blobs"
}

// blobPlaceholderPrefix / blobPlaceholderSuffix 是占位符的中间部分。
// 抽取前若原文已含该前缀则整体跳过抽取，保证还原不存在歧义
const (
	blobPlaceholderPrefix = "[[blob:"
	blobPlaceholderSuffix = "]]"
)

// blobPlaceholder 返回占位符的完整 JSON 字符串形态（含两端引号）。
// 存储态必须是合法 JSON：回填提取会话标识等路径直接读 request_body，
// 少了引号会让那些路径解析失败
func blobPlaceholder(sha string) string {
	return blobTokenPrefix + sha + blobTokenSuffix
}

// blobTokenPrefix / blobTokenSuffix 是还原时扫描的占位符形态（含引号）
const (
	blobTokenPrefix = `"` + blobPlaceholderPrefix
	blobTokenSuffix = blobPlaceholderSuffix + `"`
)

// blobMinBase64Len 小于此长度的 base64 不抽离：小块走一层间接的收益不够
const blobMinBase64Len = 1024

// blobShaHexLen 是 SHA-256 十六进制长度，用于从占位符里切出摘要
const blobShaHexLen = 64

// isBase64Payload 判断是否标准 base64 文本（含末尾填充）。
// 只认标准字符集：url-safe 变体含 -/_，容易把普通文本误判成载荷
func isBase64Payload(value string) bool {
	if len(value) < blobMinBase64Len || len(value)%4 != 0 {
		return false
	}
	padding := 0
	for i := len(value) - 1; i >= 0 && value[i] == '='; i-- {
		padding++
	}
	if padding > 2 {
		return false
	}
	for i := 0; i < len(value)-padding; i++ {
		c := value[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '+', c == '/':
		default:
			return false
		}
	}
	return true
}

// extractRequestBlobs 把请求体里的大块 base64 替换成占位符，载荷写入 blobs 表，
// 返回替换后的请求体。
//
// 替换按位置从后往前做，原文其余字节（键序、转义、数字精度）一律不动——
// 请求体是排查材料，不能因为优化存储就把它重排或改精度。原文不是 JSON
// 对象/数组、或已含占位符前缀时原样返回。
func extractRequestBlobs(requestBody string) (string, error) {
	if len(requestBody) < blobMinBase64Len || strings.Contains(requestBody, blobPlaceholderPrefix) {
		return requestBody, nil
	}
	parsed := gjson.Parse(requestBody)
	if parsed.Type != gjson.JSON {
		return requestBody, nil
	}

	type blobHit struct {
		start int
		end   int
		sha   string
		data  string
	}
	var hits []blobHit
	var walk func(value gjson.Result)
	walk = func(value gjson.Result) {
		if value.Type == gjson.JSON {
			value.ForEach(func(_, child gjson.Result) bool {
				walk(child)
				return true
			})
			return
		}
		if value.Type != gjson.String || value.Index <= 0 {
			return
		}
		payload := value.String()
		if !isBase64Payload(payload) {
			return
		}
		end := value.Index + len(value.Raw)
		if end > len(requestBody) {
			return
		}
		sum := sha256.Sum256([]byte(payload))
		hits = append(hits, blobHit{
			start: value.Index,
			end:   end,
			sha:   hex.EncodeToString(sum[:]),
			data:  payload,
		})
	}
	walk(parsed)
	if len(hits) == 0 {
		return requestBody, nil
	}

	// 同一批里同一载荷只写一次；created_at 每次引用都刷新，
	// 这样载荷的保留期等于「最近一次引用它的请求」的保留期
	now := common.GetTimestamp()
	seen := make(map[string]struct{}, len(hits))
	blobs := make([]*RequestResponseBlob, 0, len(hits))
	for i := range hits {
		if _, ok := seen[hits[i].sha]; ok {
			continue
		}
		seen[hits[i].sha] = struct{}{}
		blobs = append(blobs, &RequestResponseBlob{
			Sha256:    hits[i].sha,
			Data:      hits[i].data,
			CreatedAt: now,
		})
	}
	if err := LOG_DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "sha256"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"created_at",
		}),
	}).Create(&blobs).Error; err != nil {
		return requestBody, err
	}

	// 从后往前替换，前面的位置才不会失效
	replaced := requestBody
	for i := len(hits) - 1; i >= 0; i-- {
		replaced = replaced[:hits[i].start] + blobPlaceholder(hits[i].sha) + replaced[hits[i].end:]
	}
	return replaced, nil
}

// restoreRequestBlobs 把请求体里的占位符还原成原始 base64。
// 载荷已被保留期清理时保留占位符原样：部分内容好过让整个详情打不开
func restoreRequestBlobs(requestBody string) (string, error) {
	if !strings.Contains(requestBody, blobPlaceholderPrefix) {
		return requestBody, nil
	}
	shas := collectBlobShas(requestBody)
	if len(shas) == 0 {
		return requestBody, nil
	}

	var blobs []RequestResponseBlob
	if err := LOG_DB.Where("sha256 IN ?", shas).Find(&blobs).Error; err != nil {
		return requestBody, err
	}
	if len(blobs) == 0 {
		return requestBody, nil
	}
	bySha := make(map[string]string, len(blobs))
	for i := range blobs {
		bySha[blobs[i].Sha256] = blobs[i].Data
	}

	// 单趟扫描还原，避免每个载荷各扫一遍原文。
	// base64 字符集不含引号与反斜杠，直接拼引号即是合法 JSON 字符串
	var builder strings.Builder
	builder.Grow(len(requestBody))
	rest := requestBody
	for {
		idx := strings.Index(rest, blobTokenPrefix)
		if idx < 0 {
			builder.WriteString(rest)
			break
		}
		builder.WriteString(rest[:idx])
		rest = rest[idx+len(blobTokenPrefix):]
		end := strings.Index(rest, blobTokenSuffix)
		if end < 0 {
			builder.WriteString(blobTokenPrefix)
			builder.WriteString(rest)
			break
		}
		sha := rest[:end]
		if data, ok := bySha[sha]; ok && len(sha) == blobShaHexLen {
			builder.WriteByte('"')
			builder.WriteString(data)
			builder.WriteByte('"')
		} else {
			builder.WriteString(blobTokenPrefix)
			builder.WriteString(sha)
			builder.WriteString(blobTokenSuffix)
		}
		rest = rest[end+len(blobTokenSuffix):]
	}
	return builder.String(), nil
}

// collectBlobShas 从请求体里收集全部占位符的摘要，去重后返回
func collectBlobShas(requestBody string) []string {
	seen := make(map[string]struct{})
	var shas []string
	rest := requestBody
	for {
		idx := strings.Index(rest, blobTokenPrefix)
		if idx < 0 {
			break
		}
		rest = rest[idx+len(blobTokenPrefix):]
		end := strings.Index(rest, blobTokenSuffix)
		if end < 0 {
			break
		}
		sha := rest[:end]
		if len(sha) == blobShaHexLen {
			if _, ok := seen[sha]; !ok {
				seen[sha] = struct{}{}
				shas = append(shas, sha)
			}
		}
		rest = rest[end+len(blobTokenSuffix):]
	}
	return shas
}

// DeleteOldRequestResponseBlobBatch 分批删除保留期之前的载荷。
// 与请求/响应日志同一保留期、同一种分批理由：单行可达数 MB，
// 无上限的 DELETE 会在数 GB 的表上长时间独占写锁
func DeleteOldRequestResponseBlobBatch(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	if limit <= 0 {
		limit = 100
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}

	var shas []string
	if err := LOG_DB.WithContext(ctx).Model(&RequestResponseBlob{}).
		Where("created_at < ?", targetTimestamp).
		Order("created_at asc, sha256 asc").
		Limit(limit).
		Pluck("sha256", &shas).Error; err != nil {
		return 0, err
	}
	if len(shas) == 0 {
		return 0, nil
	}

	result := LOG_DB.WithContext(ctx).Where("sha256 IN ?", shas).Delete(&RequestResponseBlob{})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}

// CleanupOldRequestResponseBlobs 删除保留天数之前的载荷，返回删除行数。
// retentionDays 为 0 表示永久保留
func CleanupOldRequestResponseBlobs(retentionDays int) (int64, error) {
	if retentionDays <= 0 {
		return 0, nil
	}

	cutoffTimestamp := time.Now().AddDate(0, 0, -retentionDays).Unix()
	var total int64
	for {
		deleted, err := DeleteOldRequestResponseBlobBatch(context.Background(), cutoffTimestamp, requestResponseLogCleanupBatchSize)
		if err != nil {
			return total, err
		}
		total += deleted
		if deleted < requestResponseLogCleanupBatchSize {
			return total, nil
		}
	}
}
