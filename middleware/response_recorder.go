package middleware

import (
	"bufio"
	"bytes"
	"fmt"
	"net"
	"net/http"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

// responseRecorder 包装 gin.ResponseWriter，用于捕获非流式响应的完整内容
type responseRecorder struct {
	gin.ResponseWriter
	body         *bytes.Buffer
	headerWritten bool
	statusCode   int
	contentType  string
	mu           sync.Mutex
}

func newResponseRecorder(w gin.ResponseWriter) *responseRecorder {
	return &responseRecorder{
		ResponseWriter: w,
		body:           new(bytes.Buffer),
	}
}

func (r *responseRecorder) Write(data []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.headerWritten {
		r.headerWritten = true
	}
	return r.body.Write(data)
}

func (r *responseRecorder) WriteHeader(code int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.headerWritten {
		r.statusCode = code
		r.headerWritten = true
		// 在写入状态码前捕获 Content-Type
		r.contentType = r.ResponseWriter.Header().Get("Content-Type")
		r.ResponseWriter.WriteHeader(code)
	}
}

func (r *responseRecorder) Status() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.statusCode != 0 {
		return r.statusCode
	}
	return r.ResponseWriter.Status()
}

func (r *responseRecorder) Size() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.body.Len()
}

func (r *responseRecorder) Written() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.headerWritten
}

func (r *responseRecorder) WriteHeaderNow() {
	if !r.Written() {
		r.WriteHeader(http.StatusOK)
	}
}

func (r *responseRecorder) Body() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.body.String()
}

func (r *responseRecorder) BodySize() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.body.Len()
}

func (r *responseRecorder) ContentType() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.contentType
}

func (r *responseRecorder) isStreamingResponse() bool {
	ct := r.contentType
	if ct == "" {
		return false
	}
	// SSE
	if ct == "text/event-stream" {
		return true
	}
	// 二进制/音视频流
	if ct == "application/octet-stream" ||
		ct == "audio/mpeg" ||
		ct == "audio/wav" ||
		ct == "audio/ogg" ||
		ct == "audio/flac" ||
		ct == "audio/aac" ||
		ct == "video/mp4" ||
		ct == "image/png" ||
		ct == "image/jpeg" ||
		ct == "image/gif" ||
		ct == "image/webp" ||
		ct == "image/avif" {
		return true
	}
	// 以 image/ 或 audio/ 开头的也跳过
	if len(ct) > 6 && (ct[:6] == "image/" || ct[:6] == "audio/") {
		return true
	}
	return false
}

func (r *responseRecorder) Pusher() http.Pusher {
	if p, ok := r.ResponseWriter.(http.Pusher); ok {
		return p
	}
	return nil
}

func (r *responseRecorder) WriteString(s string) (int, error) {
	r.WriteHeaderNow()
	return r.body.WriteString(s)
}

// responseRecorderResponseWriter 透传所有底层 writer 能力
// 实现完整的 gin.ResponseWriter 接口
type responseRecorderResponseWriter struct {
	rec *responseRecorder
}

func (w *responseRecorderResponseWriter) Header() http.Header { return w.rec.ResponseWriter.Header() }
func (w *responseRecorderResponseWriter) Write(b []byte) (int, error) { return w.rec.Write(b) }
func (w *responseRecorderResponseWriter) WriteHeader(s int) { w.rec.WriteHeader(s) }
func (w *responseRecorderResponseWriter) WriteHeaderNow() { w.rec.WriteHeaderNow() }
func (w *responseRecorderResponseWriter) WriteString(s string) (int, error) { return w.rec.WriteString(s) }
func (w *responseRecorderResponseWriter) Status() int { return w.rec.Status() }
func (w *responseRecorderResponseWriter) Size() int { return w.rec.Size() }
func (w *responseRecorderResponseWriter) Written() bool { return w.rec.Written() }
func (w *responseRecorderResponseWriter) Pusher() http.Pusher { return w.rec.Pusher() }

func (w *responseRecorderResponseWriter) CloseNotify() <-chan bool {
	if n, ok := w.rec.ResponseWriter.(http.CloseNotifier); ok {
		return n.CloseNotify()
	}
	return nil
}

func (w *responseRecorderResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if h, ok := w.rec.ResponseWriter.(http.Hijacker); ok {
		return h.Hijack()
	}
	return nil, nil, http.ErrNotSupported
}

func (w *responseRecorderResponseWriter) Flush() {
	if f, ok := w.rec.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// isWebSocketRequest 检测是否为 WebSocket 升级请求
func isWebSocketRequest(c *gin.Context) bool {
	return c.Request.Header.Get("Upgrade") == "websocket"
}

// ResponseRecorderMiddleware 在非流式、非 WebSocket 场景下包装 c.Writer 以捕获响应体
// 仅在 common.RequestResponseLogEnabled = true 时生效
// 保存操作通过 saveFunc 回调完成，由调用方提供（避免循环导入）
func ResponseRecorderMiddleware(saveFunc func(requestId, requestBody, responseBody string, isCompleted bool, responseSize, statusCode int)) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !common.RequestResponseLogEnabled || saveFunc == nil {
			c.Next()
			return
		}

		// 跳过 WebSocket 升级请求
		if isWebSocketRequest(c) {
			c.Next()
			return
		}

		// 跳过已经包装过的请求（防止嵌套）
		if c.GetBool("response_recorder_attached") {
			c.Next()
			return
		}

		rec := newResponseRecorder(c.Writer)
		c.Writer = &responseRecorderResponseWriter{rec: rec}
		c.Set("response_recorder_attached", true)

		c.Next()

		// 仅在非流式响应且状态码已写入时保存
		if rec.headerWritten && !rec.isStreamingResponse() {
			statusCode := rec.statusCode
			if statusCode == 0 {
				statusCode = c.Writer.Status()
			}

			requestId := c.GetString(common.RequestIdKey)
			if requestId == "" {
				return
			}

			responseBody := rec.Body()
			responseSize := rec.BodySize()

			// 异步保存，不阻塞主链路
			go func() {
				defer func() {
					if r := recover(); r != nil {
						common.SysLog(fmt.Sprintf("panic in save request/response log: %v", r))
					}
				}()

				requestBody := ""
				if storage, err := common.GetBodyStorage(c); err == nil {
					if bodyBytes, bErr := storage.Bytes(); bErr == nil {
						requestBody = string(bodyBytes)
					}
				}

				saveFunc(requestId, requestBody, responseBody, true, responseSize, statusCode)
			}()
		}
	}
}
