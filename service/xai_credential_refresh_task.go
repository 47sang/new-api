package service

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

// xAI 订阅凭证的定时续期：订阅访问令牌有效期不长，靠刷新令牌长期续。
// 只扫启用 / 自动禁用态的订阅渠道；终局失败只记日志（不含令牌），不写回、不清 key。
const (
	xaiCredentialRefreshTickInterval = 10 * time.Minute
	xaiCredentialRefreshThreshold    = 24 * time.Hour
	xaiCredentialRefreshBatchSize    = 200
	xaiCredentialRefreshTimeout      = 15 * time.Second
)

var (
	xaiCredentialRefreshOnce    sync.Once
	xaiCredentialRefreshRunning atomic.Bool
)

func StartXaiCredentialAutoRefreshTask() {
	xaiCredentialRefreshOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}

		gopool.Go(func() {
			logger.LogInfo(context.Background(), common.LogText("xai credential auto-refresh task started: tick=%s threshold=%s", xaiCredentialRefreshTickInterval, xaiCredentialRefreshThreshold))

			ticker := time.NewTicker(xaiCredentialRefreshTickInterval)
			defer ticker.Stop()

			runXaiCredentialAutoRefreshOnce()
			for range ticker.C {
				runXaiCredentialAutoRefreshOnce()
			}
		})
	})
}

func runXaiCredentialAutoRefreshOnce() {
	if !xaiCredentialRefreshRunning.CompareAndSwap(false, true) {
		return
	}
	defer xaiCredentialRefreshRunning.Store(false)

	ctx := context.Background()
	now := time.Now()

	var refreshed int
	var scanned int

	offset := 0
	for {
		var channels []*model.Channel
		err := model.DB.
			Select("id", "name", "key", "status", "channel_info").
			Where("type = ? AND (status = ? OR status = ?)",
				constant.ChannelTypeXaiSub,
				common.ChannelStatusEnabled,
				common.ChannelStatusAutoDisabled,
			).
			Order("id asc").
			Limit(xaiCredentialRefreshBatchSize).
			Offset(offset).
			Find(&channels).Error
		if err != nil {
			logger.LogError(ctx, common.LogText("xai credential auto-refresh: query channels failed: %v", err))
			return
		}
		if len(channels) == 0 {
			break
		}
		offset += xaiCredentialRefreshBatchSize

		for _, ch := range channels {
			if ch == nil {
				continue
			}
			scanned++
			if ch.ChannelInfo.IsMultiKey {
				continue
			}

			rawKey := strings.TrimSpace(ch.Key)
			if rawKey == "" {
				continue
			}
			key, err := ParseXaiOAuthKey(rawKey)
			if err != nil {
				continue
			}
			if strings.TrimSpace(key.RefreshToken) == "" {
				continue
			}
			// 离过期还早就跳过；过期时间缺失或不可解析时主动续（不知道什么时候失效）
			if at, err := time.Parse(time.RFC3339, strings.TrimSpace(key.ExpiresAt)); err == nil && !at.IsZero() && at.Sub(now) > xaiCredentialRefreshThreshold {
				continue
			}

			refreshCtx, cancel := context.WithTimeout(ctx, xaiCredentialRefreshTimeout)
			newKey, _, err := RefreshXaiChannelCredential(refreshCtx, ch.Id, false)
			cancel()
			if err != nil {
				logger.LogWarn(ctx, common.LogText("xai credential auto-refresh: channel_id=%d name=%s refresh failed: %v", ch.Id, ch.Name, err))
				continue
			}

			refreshed++
			logger.LogInfo(ctx, common.LogText("xai credential auto-refresh: channel_id=%d name=%s refreshed, expires_at=%s", ch.Id, ch.Name, newKey.ExpiresAt))
		}
	}

	if refreshed > 0 {
		func() {
			defer func() {
				if r := recover(); r != nil {
					logger.LogWarn(ctx, common.LogText("xai credential auto-refresh: InitChannelCache panic: %v", r))
				}
			}()
			model.InitChannelCache()
		}()
	}

	if common.DebugEnabled {
		logger.LogDebug(ctx, "xai credential auto-refresh: scanned=%d refreshed=%d", scanned, refreshed)
	}
}
