package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// xAI 订阅登录：OAuth 2.0 设备码授权（RFC 8628），复用 xAI 官方命令行工具的公开客户端。
// 这不是 xAI 给本项目注册的应用，xAI 可能限制这种用法；界面在登录前已写明风险。
// 所有发往 xAI 的地址都必须通过主机白名单校验，对不上就拒绝，请求不发出去。
const (
	xaiOAuthClientID  = "b1a00492-073a-47ea-816f-4c329264a828"
	xaiOAuthIssuer    = "https://auth.x.ai"
	xaiOAuthHost      = "auth.x.ai"
	xaiOAuthAccount   = "accounts.x.ai"
	xaiFallbackVerify = "https://accounts.x.ai/oauth2/device"
	xaiOAuthScope     = "openid profile email offline_access grok-cli:access api:access"
	xaiScopeCLI       = "grok-cli:access"
	xaiScopeAPI       = "api:access"
)

// XaiSubscriptionBaseURL 订阅登录调用的接口根：xAI 自己的 Responses，不转成别的协议。
const XaiSubscriptionBaseURL = "https://api.x.ai/v1"

// 登录/刷新失败的类别（给界面说人话用，不含敏感信息）。
const (
	XaiFailDenied         = "denied"          // 用户在浏览器里拒绝
	XaiFailExpired        = "expired"         // 短码过期
	XaiFailTimedOut       = "timeout"         // 轮询超时
	XaiFailNetwork        = "network"         // 一时连不上
	XaiFailNoSubscription = "no_subscription" // 账号没有可用订阅
	XaiFailBadIssuer      = "bad_issuer"      // 发现文档的签发方/端点主机不在预期范围
	XaiFailRejected       = "rejected"        // 服务端其他拒绝
	XaiFailCancelled      = "cancelled"       // 用户取消
)

var (
	// ErrXaiIssuer 发现文档或端点的主机不在白名单，请求没有发出去。
	ErrXaiIssuer = errors.New("xai oauth: issuer or endpoint host is not allowed")
	// ErrXaiRefreshTerminal 刷新令牌已不能再用，这份授权该清掉重登。
	ErrXaiRefreshTerminal = errors.New("xai oauth: refresh token is no longer usable")
)

// xaiTerminalRefreshErrors 刷新时被判为终局的错误码。
var xaiTerminalRefreshErrors = map[string]bool{
	"invalid_grant":             true,
	"invalid_refresh_token":     true,
	"token_expired":             true,
	"refresh_token_expired":     true,
	"refresh_token_invalidated": true,
	"refresh_token_reused":      true,
	"invalid_client":            true,
	"unauthorized_client":       true,
}

// xaiMaxPollFailures 轮询期间连续网络失败次数上限。
const xaiMaxPollFailures = 3

// XaiOAuthKey 存进渠道 key 字段的订阅会话。字段与 codex 的 OAuthKey 同风格：
// 访问令牌用来调用，刷新令牌用来续期，其余只作展示与诊断。
type XaiOAuthKey struct {
	AccessToken  string   `json:"access_token"`
	RefreshToken string   `json:"refresh_token,omitempty"`
	IDToken      string   `json:"id_token,omitempty"`
	Email        string   `json:"email,omitempty"`
	Scopes       []string `json:"scopes,omitempty"`
	Issuer       string   `json:"issuer,omitempty"`
	TokenURL     string   `json:"token_url,omitempty"`
	ExpiresAt    string   `json:"expires_at,omitempty"` // RFC3339
	LastRefresh  string   `json:"last_refresh,omitempty"`
}

// XaiEndpoints 发现文档里核对过主机的端点。
type XaiEndpoints struct {
	DeviceURL   string
	TokenURL    string
	UserinfoURL string
}

// XaiLoginFailure 一次登录失败：类别 + 服务端错误码（均不敏感）。
type XaiLoginFailure struct {
	Reason string
	Code   string
}

func (f *XaiLoginFailure) Error() string {
	if f == nil {
		return ""
	}
	if f.Code == "" {
		return "xai login failed: " + f.Reason
	}
	return "xai login failed: " + f.Reason + ": " + f.Code
}

// XaiDeviceChallenge 给界面看的设备码。设备码本身不在这里。
type XaiDeviceChallenge struct {
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	ExpiresInSec    int64  `json:"expires_in"`
}

// XaiPollResult 轮询一次的结果。
type XaiPollResult struct {
	Status    string `json:"status"` // pending / success / failed
	RemainSec int64  `json:"remain_sec"`
	Key       *XaiOAuthKey
	Failure   *XaiLoginFailure
}

// xaiLoginSession 一次进行中的设备码登录。deviceCode 只留在服务端，不出响应。
type xaiLoginSession struct {
	id          string
	client      *xaiOAuthClient
	deviceCode  string
	userCode    string
	verifyURI   string
	tokenURL    string
	userinfoURL string
	intervalSec int64
	expiresAt   time.Time
	nextPollAt  time.Time
	failures    int
}

var (
	xaiLoginMu       sync.Mutex
	xaiLoginSessions = map[string]*xaiLoginSession{}
)

// xaiOAuthClient 一台 xAI 授权客户端。issuer 与主机名单可注入，测试里换成本机服务；
// 生产环境固定为 auth.x.ai。所有出网地址都要过 allowedHosts / verifyHosts。
type xaiOAuthClient struct {
	issuer       string
	allowedHosts []string
	verifyHosts  []string
	http         *http.Client
}

func newXaiOAuthClient(issuer string, allowedHosts, verifyHosts []string) *xaiOAuthClient {
	return &xaiOAuthClient{
		issuer:       strings.TrimRight(issuer, "/"),
		allowedHosts: allowedHosts,
		verifyHosts:  verifyHosts,
		http:         &http.Client{Timeout: defaultHTTPTimeout},
	}
}

func defaultXaiOAuthClient() *xaiOAuthClient {
	return newXaiOAuthClient(xaiOAuthIssuer, []string{xaiOAuthHost}, []string{xaiOAuthHost, xaiOAuthAccount})
}

// xaiAllowedURL 只接受 https、主机在名单里、且 URL 不带用户信息段的地址。
func xaiAllowedURL(raw string, hosts ...string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", false
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return "", false
	}
	// 本机地址（仅测试会用）允许 http，其余一律 https
	local := u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost"
	if !local && u.Scheme != "https" {
		return "", false
	}
	if u.User != nil {
		return "", false
	}
	if u.Hostname() == "" {
		return "", false
	}
	for _, h := range hosts {
		if strings.EqualFold(u.Hostname(), h) {
			return trimmed, true
		}
	}
	return "", false
}

// xaiIssuerAllowed 签发方必须严格等于期望的签发方（忽略末尾斜杠）。
func xaiIssuerAllowed(raw, expect string) bool {
	return strings.TrimRight(strings.TrimSpace(raw), "/") == strings.TrimRight(strings.TrimSpace(expect), "/")
}

// discover 读 OIDC 发现文档，只留下主机核对过的端点。
func (c *xaiOAuthClient) discover() (*XaiEndpoints, error) {
	docURL := c.issuer + "/.well-known/openid-configuration"
	body, status, err := c.get(docURL)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, &XaiLoginFailure{Reason: XaiFailNetwork, Code: fmt.Sprintf("http_%d", status)}
	}
	var doc struct {
		Issuer             string `json:"issuer"`
		DeviceAuthEndpoint string `json:"device_authorization_endpoint"`
		TokenEndpoint      string `json:"token_endpoint"`
		UserinfoEndpoint   string `json:"userinfo_endpoint"`
	}
	if err := common.Unmarshal(body, &doc); err != nil {
		return nil, &XaiLoginFailure{Reason: XaiFailBadIssuer, Code: "discovery"}
	}
	if !xaiIssuerAllowed(doc.Issuer, c.issuer) {
		return nil, &XaiLoginFailure{Reason: XaiFailBadIssuer, Code: "issuer"}
	}
	device, ok := xaiAllowedURL(doc.DeviceAuthEndpoint, c.allowedHosts...)
	if !ok {
		return nil, &XaiLoginFailure{Reason: XaiFailBadIssuer, Code: "device_endpoint"}
	}
	token, ok := xaiAllowedURL(doc.TokenEndpoint, c.allowedHosts...)
	if !ok {
		return nil, &XaiLoginFailure{Reason: XaiFailBadIssuer, Code: "token_endpoint"}
	}
	// userinfo 主机不在名单里就当没有，不影响登录
	userinfo, _ := xaiAllowedURL(doc.UserinfoEndpoint, c.allowedHosts...)
	return &XaiEndpoints{DeviceURL: device, TokenURL: token, UserinfoURL: userinfo}, nil
}

// startDeviceLogin 读发现文档、申请设备码，把会话存进进程内表并返回给界面看的短码。
func (c *xaiOAuthClient) startDeviceLogin() (*XaiDeviceChallenge, string, error) {
	endpoints, err := c.discover()
	if err != nil {
		return nil, "", err
	}

	form := url.Values{}
	form.Set("client_id", xaiOAuthClientID)
	form.Set("scope", xaiOAuthScope)
	body, status, err := c.postForm(endpoints.DeviceURL, form)
	if err != nil {
		return nil, "", &XaiLoginFailure{Reason: XaiFailNetwork, Code: "device_request"}
	}
	var resp struct {
		DeviceCode      string `json:"device_code"`
		UserCode        string `json:"user_code"`
		VerificationURI string `json:"verification_uri"`
		ExpiresIn       int64  `json:"expires_in"`
		Interval        int64  `json:"interval"`
		Error           string `json:"error"`
	}
	if err := common.Unmarshal(body, &resp); err != nil {
		return nil, "", &XaiLoginFailure{Reason: XaiFailRejected, Code: "device_response"}
	}
	if status != http.StatusOK {
		return nil, "", &XaiLoginFailure{Reason: xaiStartFailureReason(status, resp.Error), Code: resp.Error}
	}
	if resp.DeviceCode == "" || resp.UserCode == "" {
		return nil, "", &XaiLoginFailure{Reason: XaiFailRejected, Code: "no_device_code"}
	}

	// 验证页主机只认名单内的，否则回落固定的官方页
	verify, ok := xaiAllowedURL(resp.VerificationURI, c.verifyHosts...)
	if !ok {
		verify, ok = xaiAllowedURL(xaiFallbackVerify, c.verifyHosts...)
		if !ok {
			return nil, "", &XaiLoginFailure{Reason: XaiFailBadIssuer, Code: "verify_uri"}
		}
	}

	expiresIn := resp.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 900
	}
	interval := resp.Interval
	if interval <= 0 {
		interval = 5
	}

	now := time.Now()
	session := &xaiLoginSession{
		id:          xaiNewSessionID(),
		client:      c,
		deviceCode:  resp.DeviceCode,
		userCode:    resp.UserCode,
		verifyURI:   verify,
		tokenURL:    endpoints.TokenURL,
		userinfoURL: endpoints.UserinfoURL,
		intervalSec: interval,
		expiresAt:   now.Add(time.Duration(expiresIn) * time.Second),
		nextPollAt:  now,
	}

	xaiLoginMu.Lock()
	xaiLoginSessions[session.id] = session
	xaiLoginMu.Unlock()

	return &XaiDeviceChallenge{
		UserCode:        session.userCode,
		VerificationURI: session.verifyURI,
		ExpiresInSec:    expiresIn,
	}, session.id, nil
}

// poll 问一次。未到服务端约定的间隔就本地返回等待，不白打服务端。
func (c *xaiOAuthClient) poll(session *xaiLoginSession) (*XaiPollResult, error) {
	remain := func() int64 {
		if d := time.Until(session.expiresAt); d > 0 {
			return int64(d.Seconds())
		}
		return 0
	}
	fail := func(reason, code string) (*XaiPollResult, error) {
		xaiDropSession(session.id)
		return &XaiPollResult{Status: "failed", Failure: &XaiLoginFailure{Reason: reason, Code: code}}, nil
	}

	if time.Now().After(session.expiresAt) {
		return fail(XaiFailExpired, "expired_token")
	}
	if time.Now().Before(session.nextPollAt) {
		return &XaiPollResult{Status: "pending", RemainSec: remain()}, nil
	}

	tokenURL, ok := xaiAllowedURL(session.tokenURL, c.allowedHosts...)
	if !ok {
		return nil, ErrXaiIssuer
	}
	form := url.Values{}
	form.Set("client_id", xaiOAuthClientID)
	form.Set("device_code", session.deviceCode)
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
	body, status, err := c.postForm(tokenURL, form)
	if err != nil {
		// 用户在浏览器里时网关可能一时不通：连着几次才算失败
		session.failures++
		if session.failures >= xaiMaxPollFailures {
			return fail(XaiFailNetwork, "unreachable")
		}
		session.nextPollAt = time.Now().Add(time.Duration(session.intervalSec) * time.Second)
		return &XaiPollResult{Status: "pending", RemainSec: remain()}, nil
	}
	session.failures = 0

	var resp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		IDToken      string `json:"id_token"`
		ExpiresIn    int64  `json:"expires_in"`
		Scope        string `json:"scope"`
		Error        string `json:"error"`
	}
	if err := common.Unmarshal(body, &resp); err != nil {
		session.nextPollAt = time.Now().Add(time.Duration(session.intervalSec) * time.Second)
		return &XaiPollResult{Status: "pending", RemainSec: remain()}, nil
	}

	if resp.Error != "" {
		switch resp.Error {
		case "authorization_pending":
			session.nextPollAt = time.Now().Add(time.Duration(session.intervalSec) * time.Second)
			return &XaiPollResult{Status: "pending", RemainSec: remain()}, nil
		case "slow_down":
			session.intervalSec += 5
			session.nextPollAt = time.Now().Add(time.Duration(session.intervalSec) * time.Second)
			return &XaiPollResult{Status: "pending", RemainSec: remain()}, nil
		case "access_denied", "authorization_denied":
			return fail(XaiFailDenied, resp.Error)
		case "expired_token":
			return fail(XaiFailExpired, resp.Error)
		default:
			return fail(XaiFailRejected, resp.Error)
		}
	}
	if status != http.StatusOK || resp.AccessToken == "" {
		return fail(XaiFailRejected, fmt.Sprintf("http_%d", status))
	}

	scopes := xaiSplitScopes(resp.Scope)
	// 订阅门槛：授权范围里必须有订阅接口的权限
	if len(scopes) > 0 && !xaiHasSubscriptionScope(scopes) {
		return fail(XaiFailNoSubscription, "scope")
	}

	key := &XaiOAuthKey{
		AccessToken:  resp.AccessToken,
		RefreshToken: resp.RefreshToken,
		IDToken:      resp.IDToken,
		Scopes:       scopes,
		Issuer:       c.issuer,
		TokenURL:     session.tokenURL,
	}
	if resp.ExpiresIn > 0 {
		key.ExpiresAt = time.Now().Add(time.Duration(resp.ExpiresIn) * time.Second).Format(time.RFC3339)
	}
	key.Email = c.resolveEmail(session.userinfoURL, key)

	xaiDropSession(session.id)
	return &XaiPollResult{Status: "success", Key: key}, nil
}

// refresh 用刷新令牌换一组新的。终局错误返回 ErrXaiRefreshTerminal。
func (c *xaiOAuthClient) refresh(ctx context.Context, key *XaiOAuthKey) (*XaiOAuthKey, error) {
	if key == nil || strings.TrimSpace(key.RefreshToken) == "" {
		return nil, ErrXaiRefreshTerminal
	}
	tokenURL := strings.TrimSpace(key.TokenURL)
	if tokenURL == "" {
		tokenURL = c.issuer + "/oauth2/token"
	}
	checked, ok := xaiAllowedURL(tokenURL, c.allowedHosts...)
	if !ok {
		return nil, ErrXaiIssuer
	}

	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", strings.TrimSpace(key.RefreshToken))
	form.Set("client_id", xaiOAuthClientID)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, checked, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	body, err := xaiReadAll(resp)
	if err != nil {
		return nil, err
	}

	var payload struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		IDToken      string `json:"id_token"`
		ExpiresIn    int64  `json:"expires_in"`
		Scope        string `json:"scope"`
		Error        string `json:"error"`
	}
	if err := common.Unmarshal(body, &payload); err != nil && resp.StatusCode == http.StatusOK {
		return nil, fmt.Errorf("xai oauth refresh: bad response body")
	}
	if payload.Error != "" {
		if xaiTerminalRefreshErrors[payload.Error] {
			return nil, ErrXaiRefreshTerminal
		}
		return nil, fmt.Errorf("xai oauth refresh rejected: %s", payload.Error)
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, ErrXaiRefreshTerminal
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("xai oauth refresh failed: status=%d", resp.StatusCode)
	}
	if strings.TrimSpace(payload.AccessToken) == "" {
		return nil, fmt.Errorf("xai oauth refresh: missing access_token")
	}

	next := *key
	next.AccessToken = strings.TrimSpace(payload.AccessToken)
	if strings.TrimSpace(payload.RefreshToken) != "" {
		next.RefreshToken = strings.TrimSpace(payload.RefreshToken)
	}
	if strings.TrimSpace(payload.IDToken) != "" {
		next.IDToken = strings.TrimSpace(payload.IDToken)
	}
	if scopes := xaiSplitScopes(payload.Scope); len(scopes) > 0 {
		next.Scopes = scopes
	}
	if payload.ExpiresIn > 0 {
		next.ExpiresAt = time.Now().Add(time.Duration(payload.ExpiresIn) * time.Second).Format(time.RFC3339)
	} else {
		next.ExpiresAt = ""
	}
	next.LastRefresh = time.Now().Format(time.RFC3339)
	if next.Issuer == "" {
		next.Issuer = c.issuer
	}
	if next.TokenURL == "" {
		next.TokenURL = checked
	}
	return &next, nil
}

// resolveEmail 给人看的账号标识：优先 userinfo，失败就从 ID 令牌的声明里读
// （只用于显示，不拿它做授权）。读不到就留空。
func (c *xaiOAuthClient) resolveEmail(userinfoURL string, key *XaiOAuthKey) string {
	if userinfoURL != "" && key.AccessToken != "" {
		req, err := http.NewRequest(http.MethodGet, userinfoURL, nil)
		if err == nil {
			req.Header.Set("Accept", "application/json")
			req.Header.Set("Authorization", "Bearer "+key.AccessToken)
			if resp, err := c.http.Do(req); err == nil {
				body, readErr := xaiReadAll(resp)
				if readErr == nil && resp.StatusCode == http.StatusOK {
					var info struct {
						Sub               string `json:"sub"`
						Email             string `json:"email"`
						PreferredUsername string `json:"preferred_username"`
					}
					if common.Unmarshal(body, &info) == nil {
						if info.Email != "" {
							return info.Email
						}
						if info.PreferredUsername != "" {
							return info.PreferredUsername
						}
					}
				}
			}
		}
	}
	if email, ok := xaiEmailFromIDToken(key.IDToken); ok {
		return email
	}
	return ""
}

// xaiEmailFromIDToken 解 ID 令牌中段的声明取邮箱。不验签：只用来显示。
func xaiEmailFromIDToken(idToken string) (string, bool) {
	parts := strings.Split(strings.TrimSpace(idToken), ".")
	if len(parts) != 3 {
		return "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", false
	}
	var claims struct {
		Email string `json:"email"`
	}
	if err := common.Unmarshal(raw, &claims); err != nil {
		return "", false
	}
	if claims.Email == "" {
		return "", false
	}
	return claims.Email, true
}

// ParseXaiOAuthKey 解析渠道 key 字段里的订阅会话 JSON。
func ParseXaiOAuthKey(raw string) (*XaiOAuthKey, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("xai subscription channel: empty oauth key")
	}
	var key XaiOAuthKey
	if err := common.Unmarshal([]byte(trimmed), &key); err != nil {
		return nil, errors.New("xai subscription channel: invalid oauth key json")
	}
	if strings.TrimSpace(key.AccessToken) == "" {
		return nil, errors.New("xai subscription channel: oauth key must include access_token")
	}
	return &key, nil
}

// XaiOAuthKeyExpired 访问令牌是否已过期（解析不了时间按未过期处理，交给服务端判）。
func XaiOAuthKeyExpired(key *XaiOAuthKey, now time.Time) bool {
	if key == nil || strings.TrimSpace(key.ExpiresAt) == "" {
		return false
	}
	at, err := time.Parse(time.RFC3339, key.ExpiresAt)
	if err != nil {
		return false
	}
	return !now.Before(at)
}

// ---------- 导出门面：生产环境固定连 auth.x.ai ----------

// XaiStartDeviceLogin 开始一次设备码登录，返回给界面看的短码与会话号。
func XaiStartDeviceLogin() (*XaiDeviceChallenge, string, error) {
	return defaultXaiOAuthClient().startDeviceLogin()
}

// XaiPollDeviceLogin 轮询一次登录进度。
func XaiPollDeviceLogin(sessionID string) (*XaiPollResult, error) {
	xaiLoginMu.Lock()
	session := xaiLoginSessions[sessionID]
	xaiLoginMu.Unlock()
	if session == nil || session.client == nil {
		return nil, errors.New("xai oauth: login session not found")
	}
	return session.client.poll(session)
}

// XaiCancelDeviceLogin 放弃一次登录。
func XaiCancelDeviceLogin(sessionID string) {
	xaiDropSession(sessionID)
}

// XaiCurrentDeviceLogin 当前还在进行中的登录（全局同时只允许一次，见产品规格第 13 条）。
// 界面重开抽屉、刷新页面后靠它恢复显示短码与验证网址，不丢进度。
func XaiCurrentDeviceLogin() (*XaiDeviceChallenge, string, bool) {
	xaiLoginMu.Lock()
	defer xaiLoginMu.Unlock()
	now := time.Now()
	var current *xaiLoginSession
	for _, s := range xaiLoginSessions {
		if s.expiresAt.Before(now) {
			continue
		}
		if current == nil || s.expiresAt.Before(current.expiresAt) {
			current = s
		}
	}
	if current == nil {
		return nil, "", false
	}
	remain := int64(time.Until(current.expiresAt).Seconds())
	if remain < 0 {
		remain = 0
	}
	return &XaiDeviceChallenge{
		UserCode:        current.userCode,
		VerificationURI: current.verifyURI,
		ExpiresInSec:    remain,
	}, current.id, true
}

// XaiRefreshToken 用刷新令牌换一组新的。终局错误返回 ErrXaiRefreshTerminal。
func XaiRefreshToken(ctx context.Context, key *XaiOAuthKey) (*XaiOAuthKey, error) {
	return defaultXaiOAuthClient().refresh(ctx, key)
}

// ---------- 内部工具 ----------

func xaiHasSubscriptionScope(scopes []string) bool {
	for _, s := range scopes {
		if s == xaiScopeCLI || s == xaiScopeAPI {
			return true
		}
	}
	return false
}

func xaiSplitScopes(raw string) []string {
	fields := strings.Fields(raw)
	if len(fields) == 0 {
		return nil
	}
	return fields
}

func xaiStartFailureReason(status int, code string) string {
	switch {
	case status >= 500 || status == http.StatusTooManyRequests:
		return XaiFailNetwork
	case code == "access_denied" || code == "authorization_denied":
		return XaiFailDenied
	default:
		return XaiFailRejected
	}
}

func xaiDropSession(sessionID string) {
	xaiLoginMu.Lock()
	delete(xaiLoginSessions, sessionID)
	xaiLoginMu.Unlock()
}

func xaiNewSessionID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

// get 发一个 GET，只用于主机已核对过的地址。返回体不进日志。
func (c *xaiOAuthClient) get(rawURL string) ([]byte, int, error) {
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, &XaiLoginFailure{Reason: XaiFailNetwork, Code: "unreachable"}
	}
	body, err := xaiReadAll(resp)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}

func (c *xaiOAuthClient) postForm(rawURL string, form url.Values) ([]byte, int, error) {
	req, err := http.NewRequest(http.MethodPost, rawURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, err
	}
	body, err := xaiReadAll(resp)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}

func xaiReadAll(resp *http.Response) ([]byte, error) {
	if resp.Body == nil {
		return nil, nil
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}
