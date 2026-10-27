package model

import (
	"context"
	"encoding/base64"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"gorm.io/gorm"
)

// openBlobTestDB 建一个临时库并装上两张表，返回时还原 LOG_DB。
// 模型测试包共享 LOG_DB，别的测试留下的行会污染计数与内容
func openBlobTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), name)
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	require.NoError(t, err)

	previousDB := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previousDB })
	require.NoError(t, db.AutoMigrate(&RequestResponseLog{}, &RequestResponseBlob{}))
	return db
}

// base64Payload 生成指定字节数的确定性 base64 文本（可复现，便于比对）
func base64Payload(tag string, size int) string {
	raw := make([]byte, size)
	for i := range raw {
		raw[i] = byte((i*31 + len(tag)) % 251)
	}
	return base64.StdEncoding.EncodeToString(raw)
}

// TestExtractAndRestoreRequestBlobsRoundTrip 核心契约：抽离后除载荷本身外
// 其余字节一成不变，还原后与原文逐字节相等。请求体是排查材料，
// 不能因为省存储就重排键序或改掉数字精度
func TestExtractAndRestoreRequestBlobsRoundTrip(t *testing.T) {
	db := openBlobTestDB(t, "rrl-blob-roundtrip.db")

	big := base64Payload("shot", 400*1024)
	original := fmt.Sprintf(
		`{"model":"claude-opus-4-8","max_tokens":64000,"temperature":0.7,`+
			`"big_num":123456789012345678901234567890,"messages":[`+
			`{"role":"user","content":[{"type":"text","text":"看这张图\n第二行 \"引号\""},`+
			`{"type":"image","source":{"type":"base64","media_type":"image/png","data":"%s"}}]},`+
			`{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"path":"/a/b"}}]}]}`,
		big)

	replaced, err := extractRequestBlobs(original)
	require.NoError(t, err)
	require.NotEqual(t, original, replaced, "大块 base64 必须被替换")
	assert.Less(t, len(replaced), len(original)/10, "替换后应远小于原文")

	// 除载荷外的字节必须完全保留：把占位符换回原文应逐字节相等
	assert.Contains(t, replaced, blobPlaceholderPrefix)
	assert.NotContains(t, replaced, big)
	assert.Contains(t, replaced, `"big_num":123456789012345678901234567890`, "数字精度不能被改")
	assert.Contains(t, replaced, `"max_tokens":64000`)

	var count int64
	require.NoError(t, db.Model(&RequestResponseBlob{}).Count(&count).Error)
	assert.Equal(t, int64(1), count, "一个载荷只存一行")

	restored, err := restoreRequestBlobs(replaced)
	require.NoError(t, err)
	// 用布尔比较而非 Equal：testify 渲染两个 400KB 字符串会撞上 bufio.Scanner 行上限
	assert.True(t, original == restored, "还原后必须与原文逐字节相等")
}

// TestExtractRequestBlobsDedupesRepeatedPayloads 同一载荷在同一个请求体里
// 出现多次（agent 循环重发同一张图）只存一份，且每个出现位置都被替换
func TestExtractRequestBlobsDedupesRepeatedPayloads(t *testing.T) {
	db := openBlobTestDB(t, "rrl-blob-dedup.db")

	shot := base64Payload("shot", 200*1024)
	other := base64Payload("other", 200*1024)
	original := fmt.Sprintf(`{"messages":[`+
		`{"role":"user","content":[{"type":"image","source":{"type":"base64","data":"%s"}}]},`+
		`{"role":"user","content":[{"type":"image","source":{"type":"base64","data":"%s"}}]},`+
		`{"role":"user","content":[{"type":"image","source":{"type":"base64","data":"%s"}}]}]}`,
		shot, shot, other)

	replaced, err := extractRequestBlobs(original)
	require.NoError(t, err)

	var blobs []RequestResponseBlob
	require.NoError(t, db.Find(&blobs).Error)
	assert.Len(t, blobs, 2, "两个不同载荷各一行，重复的不另存")
	assert.Equal(t, strings.Count(replaced, blobPlaceholderPrefix), 3, "三个位置都要替换")

	restored, err := restoreRequestBlobs(replaced)
	require.NoError(t, err)
	assert.True(t, original == restored, "还原后必须与原文逐字节相等")
}

// TestExtractRequestBlobsSkipsNonCandidates 不该抽的一律不抽：
// 短 base64、长但非 base64 的文本、非 JSON 原文、已含占位符的原文
func TestExtractRequestBlobsSkipsNonCandidates(t *testing.T) {
	db := openBlobTestDB(t, "rrl-blob-skip.db")

	shortB64 := base64Payload("tiny", 100) // 解码后 100 字节，base64 远小于阈值
	longText := strings.Repeat("这不是 base64 中文文本 ", 200)
	cases := []struct {
		name string
		body string
	}{
		{"短 base64 不抽", fmt.Sprintf(`{"data":"%s"}`, shortB64)},
		{"长文本不是 base64", fmt.Sprintf(`{"text":%q}`, longText)},
		{"非 JSON 原文", strings.Repeat("x", 4096)},
		{"JSON 数组外的裸串", `"` + strings.Repeat("A", 4096) + `"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			replaced, err := extractRequestBlobs(tc.body)
			require.NoError(t, err)
			assert.Equal(t, tc.body, replaced, "不该被改动")
		})
	}

	var count int64
	require.NoError(t, db.Model(&RequestResponseBlob{}).Count(&count).Error)
	assert.Zero(t, count, "没有任何载荷落库")

	// 已含占位符的原文整体跳过：否则还原时会把用户文本里的占位符也当成引用
	shot := base64Payload("shot", 200*1024)
	bodyWithMarker := fmt.Sprintf(`{"note":"%s","data":"%s"}`, blobPlaceholderPrefix+"deadbeef"+blobPlaceholderSuffix, shot)
	replaced, err := extractRequestBlobs(bodyWithMarker)
	require.NoError(t, err)
	assert.Equal(t, bodyWithMarker, replaced, "已含占位符前缀时必须原样返回")
}

// TestRestoreRequestBlobsKeepsPlaceholderWhenBlobMissing 载荷被保留期清理后
// 保留占位符原样：部分内容好过让整个详情打不开
func TestRestoreRequestBlobsKeepsPlaceholderWhenBlobMissing(t *testing.T) {
	db := openBlobTestDB(t, "rrl-blob-missing.db")

	shot := base64Payload("shot", 200*1024)
	original := fmt.Sprintf(`{"data":"%s"}`, shot)
	replaced, err := extractRequestBlobs(original)
	require.NoError(t, err)

	sha := collectBlobShas(replaced)[0]
	require.NoError(t, db.Where("sha256 = ?", sha).Delete(&RequestResponseBlob{}).Error)

	restored, err := restoreRequestBlobs(replaced)
	require.NoError(t, err)
	assert.Contains(t, restored, blobPlaceholder(sha), "载荷缺失时保留占位符")
	assert.NotContains(t, restored, shot)

	// 没有占位符的原文不应触发任何查询，直接原样返回
	plain := `{"model":"gpt-4o"}`
	restored, err = restoreRequestBlobs(plain)
	require.NoError(t, err)
	assert.Equal(t, plain, restored)
}

// TestSaveAndGetRequestResponseLogRestoresBlobs 端到端：保存时抽离、
// 读取时还原，两层之间存储的是占位符形态
func TestSaveAndGetRequestResponseLogRestoresBlobs(t *testing.T) {
	db := openBlobTestDB(t, "rrl-blob-e2e.db")

	previous := common.RequestResponseLogEnabled
	common.RequestResponseLogEnabled = true
	t.Cleanup(func() { common.RequestResponseLogEnabled = previous })

	shot := base64Payload("shot", 300*1024)
	requestBody := fmt.Sprintf(
		`{"metadata":{"user_id":"{\"session_id\":\"sess-blob\"}"},"messages":[{"role":"user","content":[{"type":"image","source":{"type":"base64","data":"%s"}}]}]}`,
		shot)

	SaveRequestResponseLog("rrl-blob-e2e-1", requestBody, "resp", false, true, 4, 200)

	// 存储形态：占位符 + 会话标识照常提取
	var stored RequestResponseLog
	require.NoError(t, db.Where("request_id = ?", "rrl-blob-e2e-1").First(&stored).Error)
	assert.Contains(t, stored.RequestBody, blobPlaceholderPrefix)
	assert.NotContains(t, stored.RequestBody, shot)
	assert.Equal(t, "sess-blob", stored.SessionId, "抽离不影响会话标识提取")
	// 存储态必须是合法 JSON：占位符少了引号会让回填等直接读 request_body 的路径解析失败
	assert.True(t, gjson.Valid(stored.RequestBody), "抽离后的请求体必须仍是合法 JSON")
	assert.True(t, gjson.Get(stored.RequestBody, "metadata.user_id").Exists(), "合法 JSON 下仍能取出会话标识")

	// 读取形态：还原成原文
	loaded, err := GetRequestResponseLogByRequestId("rrl-blob-e2e-1")
	require.NoError(t, err)
	assert.True(t, requestBody == loaded.RequestBody, "读取时必须还原成客户端原文")

	// 第二次保存同一载荷（下一轮重发同一张图）不新增行
	SaveRequestResponseLog("rrl-blob-e2e-2", requestBody, "resp", false, true, 4, 200)
	var blobCount int64
	require.NoError(t, db.Model(&RequestResponseBlob{}).Count(&blobCount).Error)
	assert.Equal(t, int64(1), blobCount, "同一载荷跨请求只存一份")
}

// TestCleanupOldRequestResponseBlobs 载荷保留期清理：只删过期行、
// 分批推进、保留期内不动
func TestCleanupOldRequestResponseBlobs(t *testing.T) {
	db := openBlobTestDB(t, "rrl-blob-cleanup.db")

	const retentionDays = 3
	cutoff := time.Now().Unix() - retentionDays*24*60*60
	rows := []RequestResponseBlob{
		{Sha256: strings.Repeat("a", 64), Data: "old-1", CreatedAt: cutoff - 20},
		{Sha256: strings.Repeat("b", 64), Data: "old-2", CreatedAt: cutoff - 10},
		{Sha256: strings.Repeat("c", 64), Data: "fresh", CreatedAt: cutoff + 10},
	}
	require.NoError(t, db.Create(&rows).Error)

	var batches []int64
	for {
		deleted, err := DeleteOldRequestResponseBlobBatch(context.Background(), cutoff, 1)
		require.NoError(t, err)
		if deleted == 0 {
			break
		}
		require.LessOrEqual(t, deleted, int64(1), "单批删除行数不得超过 limit")
		batches = append(batches, deleted)
	}
	assert.Equal(t, []int64{1, 1}, batches, "limit=1 时必须一行一批删完")

	var remaining int64
	require.NoError(t, db.Model(&RequestResponseBlob{}).Count(&remaining).Error)
	assert.Equal(t, int64(1), remaining, "保留期内的载荷必须保留")

	deleted, err := CleanupOldRequestResponseBlobs(0)
	require.NoError(t, err)
	assert.Zero(t, deleted, "保留期为 0（永久保留）时一行都不删")
}
