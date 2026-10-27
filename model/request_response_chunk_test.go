package model

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// openChunkTestDB 建临时库并装上三张表，返回时还原 LOG_DB
func openChunkTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), name)
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	require.NoError(t, err)

	previousDB := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previousDB })
	require.NoError(t, db.AutoMigrate(&RequestResponseLog{}, &RequestResponseBlob{}, &RequestResponseChunk{}))
	return db
}

// repeatBody 生成一段可复现的大请求体：带 JSON 结构，且每行略有差异，
// 用来模拟「同一历史跨轮重发」
func repeatBody(tag string, rounds int) string {
	var builder strings.Builder
	builder.WriteString(`{"model":"claude-opus-4-8","messages":[`)
	for i := range rounds {
		if i > 0 {
			builder.WriteByte(',')
		}
		fmt.Fprintf(&builder,
			`{"role":"assistant","content":[{"type":"thinking","text":"%s 第 %d 轮思考 %s"},{"type":"text","text":"%s"}]}`,
			tag, i, strings.Repeat("x", 200), strings.Repeat("y", 200))
	}
	builder.WriteString(`]}`)
	return builder.String()
}

// TestGearChunksIsDeterministicAndBounded 分块必须确定（同内容同边界，否则跨轮
// 去重失效）且受 min/max 约束
func TestGearChunksIsDeterministicAndBounded(t *testing.T) {
	body := repeatBody("det", 300)
	data := []byte(body)
	require.Greater(t, len(data), chunkMaxSize*4)

	first := gearChunks(data)
	second := gearChunks(data)
	require.Equal(t, len(first), len(second), "同一内容必须切出相同块数")
	for i := range first {
		require.Equal(t, first[i], second[i], "第 %d 块边界必须一致", i)
	}
	for i, chunk := range first {
		assert.LessOrEqual(t, len(chunk), chunkMaxSize, "第 %d 块超过上限", i)
		if i < len(first)-1 {
			assert.GreaterOrEqual(t, len(chunk), chunkMinSize, "第 %d 块低于下限", i)
		}
	}
	// 拼回来必须等于原文
	var joined []byte
	for _, chunk := range first {
		joined = append(joined, chunk...)
	}
	assert.Equal(t, body, string(joined))
}

// TestChunkRequestBodyRoundTrip 核心契约：分块存储后凭索引逐字节还原
func TestChunkRequestBodyRoundTrip(t *testing.T) {
	db := openChunkTestDB(t, "rrl-chunk-roundtrip.db")

	body := repeatBody("rt", 300)
	indexed, err := chunkRequestBody(body)
	require.NoError(t, err)
	require.True(t, isChunkedBody(indexed), "大请求体必须变成分块索引")
	require.Less(t, len(indexed), len(body)/10, "索引必须远小于原文")

	restored, err := restoreChunkedBody(indexed)
	require.NoError(t, err)
	assert.True(t, body == restored, "还原后必须与原文逐字节相等")

	var chunks int64
	require.NoError(t, db.Model(&RequestResponseChunk{}).Count(&chunks).Error)
	assert.Positive(t, chunks)
}

// TestChunkRequestBodyDedupesAcrossTurns 同一历史跨轮重发只存一份：
// 第二轮只新增尾部内容，前面绝大部分块直接命中已有块
func TestChunkRequestBodyDedupesAcrossTurns(t *testing.T) {
	db := openChunkTestDB(t, "rrl-chunk-dedup.db")

	first := repeatBody("turn", 200)
	second := repeatBody("turn", 260) // 同一前缀 + 追加内容

	_, err := chunkRequestBody(first)
	require.NoError(t, err)
	var afterFirst int64
	require.NoError(t, db.Model(&RequestResponseChunk{}).Count(&afterFirst).Error)

	indexedSecond, err := chunkRequestBody(second)
	require.NoError(t, err)
	var afterSecond int64
	require.NoError(t, db.Model(&RequestResponseChunk{}).Count(&afterSecond).Error)

	added := afterSecond - afterFirst
	newContent := int64(len(second) - len(first))
	assert.Positive(t, newContent, "第二轮必须真的更长了")
	assert.LessOrEqual(t, added, afterFirst/4,
		"第二轮只应新增尾部那几块（首轮 %d 块，新增 %d 块）", afterFirst, added)

	// 两轮都能各自还原
	restored, err := restoreChunkedBody(indexedSecond)
	require.NoError(t, err)
	assert.True(t, second == restored)

	// 索引自身也必须去重收益：第二轮的索引短于原文一个量级
	assert.Less(t, len(indexedSecond), len(second)/10)
}

// TestChunkRequestBodyKeepsSmallBodiesInline 小请求体不分块：
// 索引开销接近原内容，还会为每个小请求多出一行
func TestChunkRequestBodyKeepsSmallBodiesInline(t *testing.T) {
	db := openChunkTestDB(t, "rrl-chunk-small.db")

	small := `{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`
	indexed, err := chunkRequestBody(small)
	require.NoError(t, err)
	assert.Equal(t, small, indexed, "小请求体必须原样返回")
	assert.False(t, isChunkedBody(indexed))

	var chunks int64
	require.NoError(t, db.Model(&RequestResponseChunk{}).Count(&chunks).Error)
	assert.Zero(t, chunks, "小请求体不该产生任何块")
}

// TestRestoreChunkedBodyKeepsMarkerWhenChunkMissing 块被清理后在该位置留标记，
// 其余块照常还原
func TestRestoreChunkedBodyKeepsMarkerWhenChunkMissing(t *testing.T) {
	db := openChunkTestDB(t, "rrl-chunk-missing.db")

	body := repeatBody("miss", 200)
	indexed, err := chunkRequestBody(body)
	require.NoError(t, err)
	shas, err := decodeChunkIndex(indexed)
	require.NoError(t, err)
	require.Greater(t, len(shas), 2)

	// 删掉中间一块
	require.NoError(t, db.Where("sha256 = ?", shas[len(shas)/2]).Delete(&RequestResponseChunk{}).Error)

	restored, err := restoreChunkedBody(indexed)
	require.NoError(t, err)
	assert.Contains(t, restored, chunkMissingMarker(shas[len(shas)/2]), "缺失块必须留标记")
	assert.Contains(t, restored, "第 0 轮思考", "其余块必须照常还原")
	assert.NotEqual(t, body, restored, "有残缺时不能假装完整")

	// 索引本身损坏时返回错误并原样保留内容，由调用方决定怎么降级
	broken, err := restoreChunkedBody(chunkMarkerPrefix + "!!!not-base64!!!")
	require.Error(t, err, "非法 base64 索引必须报错，不能静默当成空内容")
	assert.Equal(t, chunkMarkerPrefix+"!!!not-base64!!!", broken)
}

// TestSaveAndGetRequestResponseLogChunksBody 端到端：保存时分块去重，
// 读取时还原；会话标识在分块之前提取，不受影响
func TestSaveAndGetRequestResponseLogChunksBody(t *testing.T) {
	db := openChunkTestDB(t, "rrl-chunk-e2e.db")

	previous := common.RequestResponseLogEnabled
	common.RequestResponseLogEnabled = true
	t.Cleanup(func() { common.RequestResponseLogEnabled = previous })

	body := fmt.Sprintf(
		`{"metadata":{"user_id":"{\"session_id\":\"sess-chunk\"}"},"messages":[%s]}`,
		strings.TrimSuffix(strings.TrimPrefix(repeatBody("e2e", 200), `{"model":"claude-opus-4-8","messages":[`), `]}`))

	SaveRequestResponseLog("rrl-chunk-e2e-1", body, "resp", false, true, 4, 200)

	var stored RequestResponseLog
	require.NoError(t, db.Where("request_id = ?", "rrl-chunk-e2e-1").First(&stored).Error)
	assert.True(t, isChunkedBody(stored.RequestBody), "存储态必须是分块索引")
	assert.Less(t, len(stored.RequestBody), len(body)/10)
	assert.Equal(t, "sess-chunk", stored.SessionId, "会话标识在分块前提取，必须照常")

	loaded, err := GetRequestResponseLogByRequestId("rrl-chunk-e2e-1")
	require.NoError(t, err)
	assert.True(t, body == loaded.RequestBody, "读取时必须还原成客户端原文")

	// 下一轮重发几乎同样的历史：体量涨了三成，新增存储必须远小于新增内容
	chunkBytes := func() int64 {
		var total int64
		require.NoError(t, db.Model(&RequestResponseChunk{}).
			Select("coalesce(sum(length(data)),0)").Scan(&total).Error)
		return total
	}
	before := chunkBytes()
	next := fmt.Sprintf(
		`{"metadata":{"user_id":"{\"session_id\":\"sess-chunk\"}"},"messages":[%s]}`,
		strings.TrimSuffix(strings.TrimPrefix(repeatBody("e2e", 260), `{"model":"claude-opus-4-8","messages":[`), `]}`))
	SaveRequestResponseLog("rrl-chunk-e2e-2", next, "resp", false, true, 4, 200)
	added := chunkBytes() - before

	newContent := int64(len(next) - len(body))
	assert.Positive(t, newContent, "第二轮必须真的更长了")
	assert.Less(t, added, newContent/4,
		"下一轮只应存下新增那部分（新增内容 %d 字节，实际新增存储 %d 字节）", newContent, added)

	loadedNext, err := GetRequestResponseLogByRequestId("rrl-chunk-e2e-2")
	require.NoError(t, err)
	assert.True(t, next == loadedNext.RequestBody)
}

// TestChunkAndBlobPathsCompose base64 载荷先被抽走、剩下的再分块，
// 两层抽离按相反顺序还原后必须与原文一致
func TestChunkAndBlobPathsCompose(t *testing.T) {
	db := openChunkTestDB(t, "rrl-chunk-compose.db")

	previous := common.RequestResponseLogEnabled
	common.RequestResponseLogEnabled = true
	t.Cleanup(func() { common.RequestResponseLogEnabled = previous })

	shot := base64Payload("compose", 400*1024)
	body := fmt.Sprintf(
		`{"messages":[{"role":"user","content":[{"type":"image","source":{"type":"base64","data":"%s"}}]},%s]}`,
		shot,
		strings.TrimSuffix(strings.TrimPrefix(repeatBody("compose", 120), `{"model":"claude-opus-4-8","messages":[`), `]}`))

	SaveRequestResponseLog("rrl-compose-1", body, "resp", false, true, 4, 200)

	var stored RequestResponseLog
	require.NoError(t, db.Where("request_id = ?", "rrl-compose-1").First(&stored).Error)
	assert.True(t, isChunkedBody(stored.RequestBody), "外层必须是分块索引")
	assert.NotContains(t, stored.RequestBody, shot, "base64 必须已被抽离")

	var blobs, chunks int64
	require.NoError(t, db.Model(&RequestResponseBlob{}).Count(&blobs).Error)
	require.NoError(t, db.Model(&RequestResponseChunk{}).Count(&chunks).Error)
	assert.Equal(t, int64(1), blobs, "图片走载荷表")
	assert.Positive(t, chunks, "其余内容走分块表")

	loaded, err := GetRequestResponseLogByRequestId("rrl-compose-1")
	require.NoError(t, err)
	assert.True(t, body == loaded.RequestBody, "两层抽逆序还原后必须与原文一致")
}

// TestCleanupOldRequestResponseChunks 块保留期清理：只删过期行、分批推进
func TestCleanupOldRequestResponseChunks(t *testing.T) {
	db := openChunkTestDB(t, "rrl-chunk-cleanup.db")

	const retentionDays = 3
	cutoff := time.Now().Unix() - retentionDays*24*60*60
	rows := []RequestResponseChunk{
		{Sha256: strings.Repeat("a", 64), Data: []byte("old-1"), CreatedAt: cutoff - 20},
		{Sha256: strings.Repeat("b", 64), Data: []byte("old-2"), CreatedAt: cutoff - 10},
		{Sha256: strings.Repeat("c", 64), Data: []byte("fresh"), CreatedAt: cutoff + 10},
	}
	require.NoError(t, db.Create(&rows).Error)

	var batches []int64
	for {
		deleted, err := DeleteOldRequestResponseChunkBatch(context.Background(), cutoff, 1)
		require.NoError(t, err)
		if deleted == 0 {
			break
		}
		require.LessOrEqual(t, deleted, int64(1), "单批删除行数不得超过 limit")
		batches = append(batches, deleted)
	}
	assert.Equal(t, []int64{1, 1}, batches, "limit=1 时必须一行一批删完")

	var remaining int64
	require.NoError(t, db.Model(&RequestResponseChunk{}).Count(&remaining).Error)
	assert.Equal(t, int64(1), remaining, "保留期内的块必须保留")

	deleted, err := CleanupOldRequestResponseChunks(0)
	require.NoError(t, err)
	assert.Zero(t, deleted, "保留期为 0（永久保留）时一行都不删")
}
