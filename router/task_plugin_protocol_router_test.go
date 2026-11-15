package router

import (
	"fmt"
	"sort"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHostProtocolRegistryDrivesProtocolRoutesOnce(t *testing.T) {
	engine := gin.New()
	SetTaskPluginProtocolRouter(engine)

	expected := []string{
		"POST /v1/responses",
		"GET /v1/responses/:response_id",
		"POST /v1/videos",
		"GET /v1/videos/:task_id",
		"GET /v1/videos/:task_id/content",
		"HEAD /v1/videos/:task_id/content",
		"POST /v1/images/generations",
		"POST /v1/images/edits",
	}
	actual := make([]string, 0, len(engine.Routes()))
	for _, route := range engine.Routes() {
		actual = append(actual, fmt.Sprintf("%s %s", route.Method, route.Path))
	}
	sort.Strings(expected)
	sort.Strings(actual)
	assert.Equal(t, expected, actual)
}

// TestOpenAIImageProtocolHandlersIncludeResponseRecorder 锁住生图/改图 host
// protocol 与视频创建同档挂载 ResponseRecorderMiddleware：缺挂会导致 Log4
// 对 /v1/images/generations 一律空态（线上 gpt-image 全量无 RR 记录）。
func TestOpenAIImageProtocolHandlersIncludeResponseRecorder(t *testing.T) {
	generate, err := taskPluginProtocolHandlers("openai_image", "generate")
	require.NoError(t, err)
	edit, err := taskPluginProtocolHandlers("openai_image", "edit")
	require.NoError(t, err)
	video, err := taskPluginProtocolHandlers("openai_video", "create")
	require.NoError(t, err)
	responses, err := taskPluginProtocolHandlers("openai_responses", "create")
	require.NoError(t, err)

	// video 含录制中间件；responses 当前不含。image 必须与 video 同档。
	assert.Equal(t, len(video), len(generate))
	assert.Equal(t, len(video), len(edit))
	assert.Greater(t, len(generate), len(responses),
		"openai_image handlers must include ResponseRecorderMiddleware beyond the responses chain")
}
