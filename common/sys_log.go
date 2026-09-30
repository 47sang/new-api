package common

import (
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// LogWriterMu protects concurrent access to gin.DefaultWriter/gin.DefaultErrorWriter
// during log file rotation. Acquire RLock when reading/writing through the writers,
// acquire Lock when swapping writers and closing old files.
var LogWriterMu sync.RWMutex

// LogThrottleInterval 是同一条消息被节流抑制的最长时间窗口。
const LogThrottleInterval = time.Minute

// logThrottle 记录上一条被判定过的消息及其放行时间。
// 只保留单条槽位：既覆盖"同一个错误反复刷屏"的实际场景，也保证内存占用有上界。
var logThrottle = struct {
	sync.Mutex
	lastMsg string
	lastAt  time.Time
}{}

// AllowThrottledLog 判断一条消息当前是否值得写入日志：同一条消息在
// LogThrottleInterval 内已经写过一次时返回 false，其余情况放行并刷新时间戳。
// 用于持续性故障（例如数据库损坏后每一个请求都写日志失败）：不节流会把日志
// 文件刷满，并让真正有用的首因被成千上万条重复错误淹没。
// 不同消息之间互不影响，消息内容一变就会立即放行一条。
func AllowThrottledLog(msg string) bool {
	logThrottle.Lock()
	defer logThrottle.Unlock()
	now := time.Now()
	if msg == logThrottle.lastMsg && now.Sub(logThrottle.lastAt) < LogThrottleInterval {
		return false
	}
	logThrottle.lastMsg = msg
	logThrottle.lastAt = now
	return true
}

func SysLog(s string) {
	t := time.Now()
	LogWriterMu.RLock()
	_, _ = fmt.Fprintf(gin.DefaultWriter, "[SYS] %v | %s \n", t.Format("2006/01/02 - 15:04:05"), s)
	LogWriterMu.RUnlock()
}

// SysLogThrottled 与 SysLog 等价，但同一消息在 LogThrottleInterval 内只写一条。
func SysLogThrottled(s string) {
	if AllowThrottledLog(s) {
		SysLog(s)
	}
}

func SysError(s string) {
	t := time.Now()
	LogWriterMu.RLock()
	_, _ = fmt.Fprintf(gin.DefaultErrorWriter, "[SYS] %v | %s \n", t.Format("2006/01/02 - 15:04:05"), s)
	LogWriterMu.RUnlock()
}

// SysErrorThrottled 与 SysError 等价，但同一消息在 LogThrottleInterval 内只写一条。
func SysErrorThrottled(s string) {
	if AllowThrottledLog(s) {
		SysError(s)
	}
}

func FatalLog(v ...any) {
	t := time.Now()
	LogWriterMu.RLock()
	_, _ = fmt.Fprintf(gin.DefaultErrorWriter, "[FATAL] %v | %v \n", t.Format("2006/01/02 - 15:04:05"), v)
	LogWriterMu.RUnlock()
	os.Exit(1)
}

func LogStartupSuccess(startTime time.Time, port string) {
	duration := time.Since(startTime)
	durationMs := duration.Milliseconds()

	// Get network IPs
	networkIps := GetNetworkIps()

	LogWriterMu.RLock()
	defer LogWriterMu.RUnlock()

	if SessionCookieSecure == false {
		// Warn when the local HTTP compatibility mode disables cookie transport
		// security and refresh/logout Origin validation.
		fmt.Fprintf(gin.DefaultWriter, "\n")
		fmt.Fprintf(gin.DefaultWriter, "  \033[33mWarning: Refresh cookie is not secure and refresh/logout Origin validation is disabled. Please set SESSION_COOKIE_SECURE=true in production.\033[0m\n")
		fmt.Fprintf(gin.DefaultWriter, "\n")
	}

	fmt.Fprintf(gin.DefaultWriter, "\n")
	fmt.Fprintf(gin.DefaultWriter, "  \033[32m%s %s\033[0m  ready in %d ms\n", SystemName, Version, durationMs)
	fmt.Fprintf(gin.DefaultWriter, "\n")

	if !IsRunningInContainer() {
		fmt.Fprintf(gin.DefaultWriter, "  ➜  \033[1mLocal:\033[0m   http://localhost:%s/\n", port)
	}

	for _, ip := range networkIps {
		fmt.Fprintf(gin.DefaultWriter, "  ➜  \033[1mNetwork:\033[0m http://%s:%s/\n", ip, port)
	}

	fmt.Fprintf(gin.DefaultWriter, "\n")
}
