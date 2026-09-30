package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAllowThrottledLogSuppressesRepeatedMessage 回归验证：同一条消息在抑制窗口内
// 只放行第一次。持续性故障（例如数据库损坏后每个请求都写日志失败）若不节流，会把
// 日志文件刷满，并淹没真正有用的首因。
func TestAllowThrottledLogSuppressesRepeatedMessage(t *testing.T) {
	const msg = "throttle-repeated-message"

	require.True(t, AllowThrottledLog(msg), "首次出现必须放行")
	assert.False(t, AllowThrottledLog(msg), "窗口内重复出现必须被抑制")
	assert.False(t, AllowThrottledLog(msg), "窗口内连续重复都必须被抑制")
}

// TestAllowThrottledLogDoesNotSwallowDifferentMessage 回归验证：不同消息之间互不
// 影响。若把不同错误也一并抑制，新出现的故障会被上一条错误顶掉，延迟一个窗口才可见。
func TestAllowThrottledLogDoesNotSwallowDifferentMessage(t *testing.T) {
	const first = "throttle-first-message"
	const second = "throttle-second-message"

	require.True(t, AllowThrottledLog(first))
	assert.False(t, AllowThrottledLog(first), "同一条消息在窗口内仍应被抑制")
	assert.True(t, AllowThrottledLog(second), "不同消息必须立即放行")
}
