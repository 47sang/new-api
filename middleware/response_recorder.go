package middleware

import (
	"bytes"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

// saveSemaphore 限制并发落库的 goroutine 数量：
// 防止日志库变慢时（SQLite 锁、MySQL 慢查询）保存 goroutine 无界堆积导致内存膨胀
var saveSemaphore = make(chan struct{}, 8)

// responseRecorder 内嵌 gin.ResponseWriter，对 Write/WriteString 做 tee：
// 同时写入底层 writer（转发给客户端）和内存缓冲（用于落库）
// 其余方法（Flush/Hijack/CloseNotify/Status/Size 等）由内嵌接口自动透传
type responseRecorder struct {
	gin.ResponseWriter
	body        *bytes.Buffer
	contentType string
	mu          sync.Mutex
}

func newResponseRecorder(w gin.ResponseWriter) *responseRecorder {
	return &responseRecorder{
		ResponseWriter: w,
		body:           new(bytes.Buffer),
	}
}

// Unwrap 供 http.ResponseController 穿透包装，
// 保证 relay 流式链路对底层连接的 SetWriteDeadline（慢客户端 30s 写超时保护）仍然生效
func (r *responseRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}

// captureContentType 在状态码写出前缓存 Content-Type（写出后 Header 仍可读，这里取一次即可）
func (r *responseRecorder) captureContentType() {
	if r.contentType == "" {
		r.contentType = r.ResponseWriter.Header().Get("Content-Type")
	}
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	r.mu.Lock()
	r.captureContentType()
	r.body.Write(b)
	r.mu.Unlock()
	return r.ResponseWriter.Write(b)
}

func (r *responseRecorder) WriteString(s string) (int, error) {
	r.mu.Lock()
	r.captureContentType()
	r.body.WriteString(s)
	r.mu.Unlock()
	return r.ResponseWriter.WriteString(s)
}

func (r *responseRecorder) WriteHeader(code int) {
	r.mu.Lock()
	r.captureContentType()
	r.mu.Unlock()
	r.ResponseWriter.WriteHeader(code)
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

// isStreamingResponse 判断响应是否为流式（SSE）。
// 用前缀而非精确相等：上游 Content-Type 可能携带参数（如 "text/event-stream; charset=utf-8"）
func (r *responseRecorder) isStreamingResponse() bool {
	ct := strings.ToLower(r.ContentType())
	return strings.HasPrefix(ct, "text/event-stream")
}

// isBinaryResponse 判断响应是否为二进制内容（图片/音频/视频等），此类响应体不落库
func (r *responseRecorder) isBinaryResponse() bool {
	ct := strings.ToLower(r.ContentType())
	if ct == "" {
		return false
	}
	if ct == "application/octet-stream" {
		return true
	}
	return strings.HasPrefix(ct, "image/") ||
		strings.HasPrefix(ct, "audio/") ||
		strings.HasPrefix(ct, "video/")
}

// isWebSocketRequest 检测是否为 WebSocket 升级请求
func isWebSocketRequest(c *gin.Context) bool {
	return c.Request.Header.Get("Upgrade") == "websocket"
}

// saveRequestResponse 提取请求/响应内容并异步落库
// 通过 defer 调用：正常结束与 handler 链 panic（被外层 CustomRecovery 捕获前）都会执行，
// 保证出错的请求也能留下记录
func saveRequestResponse(c *gin.Context, rec *responseRecorder, saveFunc func(requestId, requestBody, responseBody string, isStream bool, isCompleted bool, responseSize, statusCode int)) {
	requestId := c.GetString(common.RequestIdKey)
	if requestId == "" {
		return
	}

	// 请求体在此同步读取（此时 BodyStorageCleanup 尚未执行），
	// 转 string 后传给异步 goroutine，避免与请求结束后的存储清理产生竞态
	requestBody := ""
	if strings.HasPrefix(c.Request.Header.Get("Content-Type"), "multipart/form-data") {
		// 二进制文件上传内容不落库，保存占位符
		requestBody = "[multipart request body omitted]"
	} else if storage, err := common.GetBodyStorage(c); err == nil {
		if bodyBytes, bErr := storage.Bytes(); bErr == nil {
			requestBody = string(bodyBytes)
		}
	}

	responseBody := ""
	responseSize := 0
	isCompleted := false
	if !rec.isBinaryResponse() {
		responseBody = rec.Body()
		responseSize = rec.BodySize()
		// 流式正常结束或非流式完整响应为 true；客户端中断时 context 会携带取消错误
		isCompleted = c.Request.Context().Err() == nil
	}

	statusCode := rec.Status()
	isStream := rec.isStreamingResponse()

	// 非阻塞获取信号量：日志库积压时丢弃新日志并告警，避免内存无限增长
	select {
	case saveSemaphore <- struct{}{}:
	default:
		common.SysLog("request/response log save queue is full, dropped log for request " + requestId)
		return
	}

	// 异步保存，不阻塞主链路
	go func() {
		defer func() {
			<-saveSemaphore
			if r := recover(); r != nil {
				common.SysLog(fmt.Sprintf("panic in save request/response log: %v", r))
			}
		}()

		// 流式响应在落库前合并为单个最终响应对象（CPU 密集，放在异步 goroutine 中执行）；
		// 未识别的格式原样保留原始 SSE 报文
		if isStream {
			responseBody = mergeStreamResponseBody(responseBody)
		}

		saveFunc(requestId, requestBody, responseBody, isStream, isCompleted, responseSize, statusCode)
	}()
}

// ResponseRecorderMiddleware 包装 c.Writer 以捕获请求/响应完整内容
// 仅在 common.RequestResponseLogEnabled = true 时生效
// 流式（SSE）分片只在内存累积，请求结束后一次性落库；保存操作通过 saveFunc 回调完成（避免循环导入）
func ResponseRecorderMiddleware(saveFunc func(requestId, requestBody, responseBody string, isStream bool, isCompleted bool, responseSize, statusCode int)) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !common.RequestResponseLogEnabled || saveFunc == nil {
			c.Next()
			return
		}

		// 跳过 WebSocket 升级请求（/v1/realtime 在独立路由组，此处为兜底）
		if isWebSocketRequest(c) {
			c.Next()
			return
		}

		rec := newResponseRecorder(c.Writer)
		c.Writer = rec

		defer saveRequestResponse(c, rec, saveFunc)

		c.Next()
	}
}
