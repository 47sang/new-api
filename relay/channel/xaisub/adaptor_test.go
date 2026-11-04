package xaisub

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/gin-gonic/gin"
)

func TestGetRequestURLFixedBase(t *testing.T) {
	adaptor := &Adaptor{}
	cases := []struct {
		name string
		mode int
		want string
	}{
		{name: "responses", mode: relayconstant.RelayModeResponses, want: "https://api.x.ai/v1/responses"},
		{name: "responses compact", mode: relayconstant.RelayModeResponsesCompact, want: "https://api.x.ai/v1/responses/compact"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// 渠道上存的地址不该影响请求目标：订阅登录的接口根是固定的
			info := &common.RelayInfo{
				ChannelMeta: &common.ChannelMeta{ChannelBaseUrl: "https://attacker.example"},
				RelayMode:   tc.mode,
			}
			got, err := adaptor.GetRequestURL(info)
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestGetRequestURLRejectsOtherModes(t *testing.T) {
	adaptor := &Adaptor{}
	info := &common.RelayInfo{
		ChannelMeta: &common.ChannelMeta{},
		RelayMode:   relayconstant.RelayModeChatCompletions,
	}
	_, err := adaptor.GetRequestURL(info)
	assert.Error(t, err)
}

func TestSetupRequestHeaderUsesSubscriptionToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	adaptor := &Adaptor{}

	c, rec := newTestContext(t)
	req := http.Header{}
	info := &common.RelayInfo{
		ChannelMeta: &common.ChannelMeta{ApiKey: `{"access_token":"at-sub-1","refresh_token":"rt-1"}`},
	}
	require.NoError(t, adaptor.SetupRequestHeader(c, &req, info))
	assert.Equal(t, "Bearer at-sub-1", req.Get("Authorization"))
	assert.Empty(t, rec.Body.String())
}

func TestSetupRequestHeaderRejectsBadKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	adaptor := &Adaptor{}

	cases := []struct {
		name   string
		apiKey string
	}{
		{name: "not json", apiKey: "sk-plain-api-key"},
		{name: "missing access_token", apiKey: `{"refresh_token":"rt-1"}`},
		{name: "empty", apiKey: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := newTestContext(t)
			req := http.Header{}
			info := &common.RelayInfo{ChannelMeta: &common.ChannelMeta{ApiKey: tc.apiKey}}
			err := adaptor.SetupRequestHeader(c, &req, info)
			require.Error(t, err)
			// 报错里不能带出密钥原文
			if tc.apiKey != "" {
				assert.NotContains(t, err.Error(), tc.apiKey)
			}
			assert.Empty(t, req.Get("Authorization"))
		})
	}
}

// TestEmbeddedModelConversionIsShared 嵌入 xai.Adaptor 后，模型相关转换与 48 号渠道一致。
func TestEmbeddedModelConversionIsShared(t *testing.T) {
	adaptor := &Adaptor{}
	info := &common.RelayInfo{ChannelMeta: &common.ChannelMeta{}}
	assert.NotEmpty(t, adaptor.GetModelList())
	assert.NotEmpty(t, adaptor.GetChannelName())
	_ = info
	// 解析失败的 key 在适配器层就被挡住，不会走到请求里
	_, err := service.ParseXaiOAuthKey("nope")
	assert.Error(t, err)
}

// TestDoRequestUsesSubscriptionAuth 回归：嵌入的 xai.DoRequest 会把 *xai.Adaptor
// 传进 DoApiRequest，从而绕过本包 SetupRequestHeader，把整段 OAuth JSON / 明文
// sk- 当 API Key 发出（上游 Incorrect API key）。本包 DoRequest 必须先走订阅解析。
func TestDoRequestUsesSubscriptionAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{}`))
	c.Request.Header.Set("Content-Type", "application/json")

	info := &common.RelayInfo{
		ChannelMeta: &common.ChannelMeta{
			ApiKey:         "sk-plain-not-oauth-json",
			ChannelBaseUrl: "https://api.x.ai",
		},
		RelayMode:      relayconstant.RelayModeResponses,
		RequestURLPath: "/v1/responses",
	}

	_, err := (&Adaptor{}).DoRequest(c, info, strings.NewReader(`{"model":"grok-4"}`))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "setup request header failed")
	assert.Contains(t, err.Error(), "oauth")
	assert.NotContains(t, err.Error(), "sk-plain-not-oauth-json")
}

func newTestContext(t *testing.T) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "https://api.x.ai/v1/responses", nil)
	return c, rec
}
