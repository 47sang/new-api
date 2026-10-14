package inflight

import (
	"fmt"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
)

const (
	// snapshotInterval 是快照推送周期。
	snapshotInterval = time.Second
	// heartbeatInterval 是心跳注释帧周期，用于让客户端与中间反代识别连接仍存活。
	heartbeatInterval = 15 * time.Second
)

// Stream 以 SSE 向管理员推送在途请求快照。
// 路由上已挂 AdminAuth，这里不再做权限判断。
func Stream(c *gin.Context) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	// 反代（nginx 等）默认会缓冲 SSE，显式关闭
	c.Header("X-Accel-Buffering", "no")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		return
	}

	snapshotTicker := time.NewTicker(snapshotInterval)
	defer snapshotTicker.Stop()
	heartbeatTicker := time.NewTicker(heartbeatInterval)
	defer heartbeatTicker.Stop()

	writeSnapshot := func() bool {
		data, err := common.Marshal(TakeSnapshot())
		if err != nil {
			return false
		}
		if _, err := fmt.Fprintf(c.Writer, "event: snapshot\ndata: %s\n\n", data); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	// 立即推一帧，前端不必等一个周期
	if !writeSnapshot() {
		return
	}

	ctx := c.Request.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-snapshotTicker.C:
			if !writeSnapshot() {
				return
			}
		case <-heartbeatTicker.C:
			if _, err := fmt.Fprint(c.Writer, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
