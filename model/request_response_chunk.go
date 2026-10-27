package model

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/klauspost/compress/zstd"
	"gorm.io/gorm/clause"
)

// RequestResponseChunk 存储请求体的内容定义分块，按内容 SHA-256 去重后压缩。
//
// 一个对话任务每轮都把全量历史重发一遍：实测 60 行 40.2MB 的请求体，
// 唯一内容只有 1.8MB。逐行压缩的字典各自独立，吃不到这份跨轮重复
// （实测仅 2.8x）；按内容寻址分块后同一段历史只存一份（实测 21x），
// 唯一块再压缩后约 50x。
type RequestResponseChunk struct {
	Sha256    string `json:"sha256" gorm:"type:varchar(64);primaryKey"`
	Data      []byte `json:"data"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;index"`
}

func (RequestResponseChunk) TableName() string {
	return "request_response_chunks"
}

const (
	// chunkMarkerPrefix 是 request_body 列里分块索引的前缀。
	// 带前缀才能把索引和真正的请求体区分开
	chunkMarkerPrefix = "cdc1:"

	// chunkMinSize / chunkMaxSize / chunkMask 决定分块边界：
	// 最小 2KB、最大 32KB、按 gear 哈希以约 8KB 为期望值切分
	chunkMinSize = 2048
	chunkMaxSize = 32768
	chunkMask    = 1<<13 - 1

	// chunkShaHexLen 是 SHA-256 十六进制长度
	chunkShaHexLen = 64

	// chunkInlineThreshold 小于此长度的请求体不分块：索引开销接近原内容，
	// 还会为每个小请求额外产生一行
	chunkInlineThreshold = chunkMinSize
)

var (
	// errInvalidChunkIndex 索引不是合法的 base64 或长度不是块的整数倍
	errInvalidChunkIndex = errors.New("invalid request chunk index")
	// errChunkDecoderUnavailable zstd 解码器创建失败（极少见）
	errChunkDecoderUnavailable = errors.New("request chunk decoder is unavailable")
)

// chunkGear 是 gear 哈希的查找表。必须在进程间保持确定：
// 同一段内容今天切出的边界，明天必须完全一致，否则跨轮去重会失效
var chunkGear = func() [256]uint32 {
	var table [256]uint32
	state := uint32(0x9e3779b9)
	for i := range table {
		state = state*1664525 + 1013904223
		table[i] = state
	}
	return table
}()

var (
	chunkEncoderOnce sync.Once
	chunkEncoder     *zstd.Encoder
	chunkDecoderOnce sync.Once
	chunkDecoder     *zstd.Decoder
)

func getChunkEncoder() *zstd.Encoder {
	chunkEncoderOnce.Do(func() {
		encoder, err := zstd.NewWriter(nil, zstd.WithEncoderLevel(zstd.SpeedDefault))
		if err != nil {
			common.SysError("failed to create chunk zstd encoder: " + err.Error())
			return
		}
		chunkEncoder = encoder
	})
	return chunkEncoder
}

func getChunkDecoder() *zstd.Decoder {
	chunkDecoderOnce.Do(func() {
		decoder, err := zstd.NewReader(nil)
		if err != nil {
			common.SysError("failed to create chunk zstd decoder: " + err.Error())
			return
		}
		chunkDecoder = decoder
	})
	return chunkDecoder
}

// gearChunks 按内容定义边界切分数据。相同内容必然得到完全相同的切分结果。
// 用旋转+异或的 buzhash 形式而不是 (h<<1)+C：后者在长常量串（重复空白、
// base64、缩进）上会收敛成周期序列，边界几乎不出现，块会被撑到上限，
// 去重粒度随之变粗
func gearChunks(data []byte) [][]byte {
	var chunks [][]byte
	for start := 0; start < len(data); {
		limit := min(start+chunkMaxSize, len(data))
		end := limit
		var hash uint32
		for i := start; i < limit; i++ {
			hash = ((hash << 1) | (hash >> 31)) ^ chunkGear[data[i]]
			if i-start+1 >= chunkMinSize && hash&chunkMask == 0 {
				end = i + 1
				break
			}
		}
		chunks = append(chunks, data[start:end])
		start = end
	}
	return chunks
}

// isChunkedBody 判断 request_body 存的是不是分块索引
func isChunkedBody(body string) bool {
	return strings.HasPrefix(body, chunkMarkerPrefix)
}

// chunkRequestBody 把请求体切成内容定义块，按内容寻址写入 chunks 表，
// 返回索引字符串。小于阈值的请求体原样返回（不分块）
func chunkRequestBody(requestBody string) (string, error) {
	if len(requestBody) < chunkInlineThreshold {
		return requestBody, nil
	}

	data := []byte(requestBody)
	chunks := gearChunks(data)
	if len(chunks) <= 1 {
		// 只有一块时分块没有收益，还要多付一行索引
		return requestBody, nil
	}

	encoder := getChunkEncoder()
	if encoder == nil {
		return requestBody, nil
	}

	now := common.GetTimestamp()
	shas := make([]string, 0, len(chunks))
	rawIndex := make([]byte, 0, len(chunks)*sha256.Size)
	seen := make(map[string]struct{}, len(chunks))
	var pending []*RequestResponseChunk
	for _, chunk := range chunks {
		sum := sha256.Sum256(chunk)
		shaHex := hex.EncodeToString(sum[:])
		shas = append(shas, shaHex)
		rawIndex = append(rawIndex, sum[:]...)
		if _, ok := seen[shaHex]; ok {
			continue
		}
		seen[shaHex] = struct{}{}
		pending = append(pending, &RequestResponseChunk{
			Sha256:    shaHex,
			Data:      encoder.EncodeAll(chunk, nil),
			CreatedAt: now,
		})
	}

	// created_at 每次引用都刷新，块的存活期等于最近一次引用它的请求
	if err := LOG_DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "sha256"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"created_at",
		}),
	}).Create(&pending).Error; err != nil {
		return requestBody, err
	}

	return chunkMarkerPrefix + base64.StdEncoding.EncodeToString(rawIndex), nil
}

// decodeChunkIndex 把索引字符串还原成块摘要列表（顺序即拼接顺序）
func decodeChunkIndex(body string) ([]string, error) {
	encoded := strings.TrimPrefix(body, chunkMarkerPrefix)
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 || len(raw)%sha256.Size != 0 {
		return nil, errInvalidChunkIndex
	}
	shas := make([]string, 0, len(raw)/sha256.Size)
	for i := 0; i < len(raw); i += sha256.Size {
		shas = append(shas, hex.EncodeToString(raw[i:i+sha256.Size]))
	}
	return shas, nil
}

// restoreChunkedBody 按索引把块拼回原始请求体。
// 块已被保留期清理时在该位置留下标记：内容有残缺也好过整个详情打不开
func restoreChunkedBody(body string) (string, error) {
	shas, err := decodeChunkIndex(body)
	if err != nil {
		return body, err
	}

	var chunks []RequestResponseChunk
	if err := LOG_DB.Where("sha256 IN ?", shas).Find(&chunks).Error; err != nil {
		return body, err
	}
	bySha := make(map[string][]byte, len(chunks))
	for i := range chunks {
		bySha[chunks[i].Sha256] = chunks[i].Data
	}

	decoder := getChunkDecoder()
	if decoder == nil {
		return body, errChunkDecoderUnavailable
	}

	var builder bytes.Buffer
	for _, sha := range shas {
		compressed, ok := bySha[sha]
		if !ok {
			builder.WriteString(chunkMissingMarker(sha))
			continue
		}
		raw, decodeErr := decoder.DecodeAll(compressed, nil)
		if decodeErr != nil {
			// 单块解不开就跳过它，其余块照常还原
			common.SysErrorThrottled("failed to decompress request chunk: " + decodeErr.Error())
			builder.WriteString(chunkMissingMarker(sha))
			continue
		}
		builder.Write(raw)
	}
	return builder.String(), nil
}

// chunkMissingMarker 标记一个取不回来的块，便于在详情里看出残缺位置
func chunkMissingMarker(sha string) string {
	return "[[chunk:" + sha + "]]"
}

// DeleteOldRequestResponseChunkBatch 分批删除保留期之前的块。
// 与请求/响应日志同一保留期、同一种分批理由：一次删太多会把写锁握太久
func DeleteOldRequestResponseChunkBatch(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	if limit <= 0 {
		limit = 100
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}

	var shas []string
	if err := LOG_DB.WithContext(ctx).Model(&RequestResponseChunk{}).
		Where("created_at < ?", targetTimestamp).
		Order("created_at asc, sha256 asc").
		Limit(limit).
		Pluck("sha256", &shas).Error; err != nil {
		return 0, err
	}
	if len(shas) == 0 {
		return 0, nil
	}

	result := LOG_DB.WithContext(ctx).Where("sha256 IN ?", shas).Delete(&RequestResponseChunk{})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}

// CleanupOldRequestResponseChunks 删除保留天数之前的块，返回删除行数。
// retentionDays 为 0 表示永久保留
func CleanupOldRequestResponseChunks(retentionDays int) (int64, error) {
	if retentionDays <= 0 {
		return 0, nil
	}

	cutoffTimestamp := time.Now().AddDate(0, 0, -retentionDays).Unix()
	var total int64
	for {
		deleted, err := DeleteOldRequestResponseChunkBatch(context.Background(), cutoffTimestamp, requestResponseLogCleanupBatchSize)
		if err != nil {
			return total, err
		}
		total += deleted
		if deleted < requestResponseLogCleanupBatchSize {
			return total, nil
		}
	}
}
