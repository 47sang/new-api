package xaisub

import (
	"errors"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/xai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// Adaptor xAI 订阅渠道：复用 xAI 的 Responses 接口与模型转换，令牌来自订阅授权
// （渠道 key 里的 OAuth JSON），不用 API Key。接口地址固定，不允许指向别的主机。
type Adaptor struct {
	xai.Adaptor
}

// GetRequestURL 固定打到 xAI 自己的 Responses 接口，只服务 Responses 一族。
func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	var path string
	switch info.RelayMode {
	case relayconstant.RelayModeResponses:
		path = "/responses"
	case relayconstant.RelayModeResponsesCompact:
		path = "/responses/compact"
	default:
		return "", errors.New("xai subscription channel: only /v1/responses is supported")
	}
	return service.XaiSubscriptionBaseURL + path, nil
}

// SetupRequestHeader 从渠道 key 的订阅会话里取访问令牌。key 不是有效订阅凭证时
// 明确报错，不把 JSON 原文发出去。
func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)

	oauthKey, err := service.ParseXaiOAuthKey(info.ApiKey)
	if err != nil {
		return err
	}
	accessToken := strings.TrimSpace(oauthKey.AccessToken)
	if accessToken == "" {
		return errors.New("xai subscription channel: access_token is required")
	}
	req.Set("Authorization", "Bearer "+accessToken)
	return nil
}
