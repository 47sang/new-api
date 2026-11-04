package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
)

// RefreshXaiChannelCredential 用一个渠道的刷新令牌换一组新的，写回渠道 key。
// 终局拒绝（刷新令牌已不能再用）返回 ErrXaiRefreshTerminal，调用方据此把渠道
// 标记为登录失效，不清 key——旧令牌继续用到失效，由请求路径报错。
func RefreshXaiChannelCredential(ctx context.Context, channelID int, resetCaches bool) (*XaiOAuthKey, *model.Channel, error) {
	ch, err := model.GetChannelById(channelID, true)
	if err != nil {
		return nil, nil, err
	}
	if ch == nil {
		return nil, nil, fmt.Errorf("channel not found")
	}
	if ch.Type != constant.ChannelTypeXaiSub {
		return nil, nil, fmt.Errorf("channel type is not xAI subscription")
	}

	key, err := ParseXaiOAuthKey(strings.TrimSpace(ch.Key))
	if err != nil {
		return nil, nil, err
	}
	if strings.TrimSpace(key.RefreshToken) == "" {
		return nil, nil, fmt.Errorf("xai subscription channel: refresh_token is required to refresh credential")
	}

	refreshCtx, cancel := context.WithTimeout(ctx, xaiCredentialRefreshTimeout)
	defer cancel()

	// 出站走渠道自己配的代理：墙内直连不了 xAI，续期绕过代理会在到期后静默失效
	next, err := XaiRefreshTokenWithProxy(refreshCtx, key, ch.GetSetting().Proxy, ch.GetSetting())
	if err != nil {
		return nil, nil, err
	}

	encoded, err := common.Marshal(next)
	if err != nil {
		return nil, nil, err
	}
	if err := model.DB.Model(&model.Channel{}).Where("id = ?", ch.Id).Update("key", string(encoded)).Error; err != nil {
		return nil, nil, err
	}

	if resetCaches {
		model.InitChannelCache()
	}
	return next, ch, nil
}
