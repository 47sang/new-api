package service

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/relaykit/dto"
)

// newTestXaiClient 指向本机假服务的授权客户端。生产主机仍强制 https，
// 本机豁免只存在于 xaiAllowedURL 里，测试客户端显式传入。
func newTestXaiClient(t *testing.T, hosts ...string) (*xaiOAuthClient, *int32) {
	t.Helper()
	var hits int32
	return &xaiOAuthClient{
		issuer:       "http://127.0.0.1",
		allowedHosts: hosts,
		verifyHosts:  append(append([]string{}, hosts...), xaiOAuthAccount),
		http:         &http.Client{Timeout: 5 * time.Second},
	}, &hits
}

func TestXaiAllowedURL(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		host string
		want bool
	}{
		{name: "https on allowed host", raw: "https://auth.x.ai/oauth2/token", host: "auth.x.ai", want: true},
		{name: "http rejected for remote host", raw: "http://auth.x.ai/oauth2/token", host: "auth.x.ai", want: false},
		{name: "other host rejected", raw: "https://evil.example/token", host: "auth.x.ai", want: false},
		{name: "userinfo in url rejected", raw: "https://user:pass@auth.x.ai/token", host: "auth.x.ai", want: false},
		{name: "empty rejected", raw: "   ", host: "auth.x.ai", want: false},
		{name: "garbage rejected", raw: "://nope", host: "auth.x.ai", want: false},
		{name: "case insensitive host", raw: "https://AUTH.X.AI/token", host: "auth.x.ai", want: true},
		{name: "local http allowed for tests", raw: "http://127.0.0.1:1234/token", host: "127.0.0.1", want: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, ok := xaiAllowedURL(tc.raw, tc.host)
			if ok != tc.want {
				t.Fatalf("xaiAllowedURL(%q, %q) = %v, want %v", tc.raw, tc.host, ok, tc.want)
			}
		})
	}
}

func TestXaiDiscoverRejects(t *testing.T) {
	cases := []struct {
		name       string
		issuer     string
		deviceURL  string
		tokenURL   string
		wantReason string
		wantCode   string
	}{
		{
			name: "issuer mismatch", issuer: "https://evil.example",
			wantReason: XaiFailBadIssuer, wantCode: "issuer",
		},
		{
			name: "device endpoint on foreign host", issuer: "SERVER",
			deviceURL:  "https://evil.example/device",
			wantReason: XaiFailBadIssuer, wantCode: "device_endpoint",
		},
		{
			name: "token endpoint on foreign host", issuer: "SERVER",
			deviceURL: "", tokenURL: "https://evil.example/token",
			wantReason: XaiFailBadIssuer, wantCode: "token_endpoint",
		},
		{
			name: "device endpoint over http", issuer: "SERVER",
			deviceURL:  "http://auth.x.ai/device",
			wantReason: XaiFailBadIssuer, wantCode: "device_endpoint",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var tokenHits int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.Contains(r.URL.Path, "token") {
					atomic.AddInt32(&tokenHits, 1)
				}
				w.Header().Set("Content-Type", "application/json")
				base := serverURL(r)
				device := tc.deviceURL
				if device == "" {
					device = base + "/device"
				}
				token := tc.tokenURL
				if token == "" {
					token = base + "/token"
				}
				issuer := strings.ReplaceAll(tc.issuer, "SERVER", base)
				_, _ = w.Write([]byte(`{"issuer":"` + issuer + `","device_authorization_endpoint":"` + device + `","token_endpoint":"` + token + `"}`))
			}))
			defer server.Close()

			client, _ := newTestXaiClient(t, "127.0.0.1")
			client.issuer = server.URL
			_, err := client.discover()
			failure, ok := err.(*XaiLoginFailure)
			if !ok {
				t.Fatalf("want *XaiLoginFailure, got %v", err)
			}
			if failure.Reason != tc.wantReason || failure.Code != tc.wantCode {
				t.Fatalf("got %s/%s, want %s/%s", failure.Reason, failure.Code, tc.wantReason, tc.wantCode)
			}
			if atomic.LoadInt32(&tokenHits) != 0 {
				t.Fatalf("token endpoint must not be called, hits=%d", tokenHits)
			}
		})
	}
}

// TestXaiDeviceLoginAndPoll 走完 pending → slow_down → tokens 的轮询序列，
// 并验证验证页主机不在名单时回落固定的官方页。
func TestXaiDeviceLoginAndPoll(t *testing.T) {
	var deviceHits, tokenHits, userinfoHits int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/.well-known/openid-configuration"):
			_, _ = w.Write([]byte(`{"issuer":"` + serverURL(r) + `","device_authorization_endpoint":"` + serverURL(r) + `/device","token_endpoint":"` + serverURL(r) + `/token","userinfo_endpoint":"` + serverURL(r) + `/userinfo"}`))
		case strings.HasSuffix(r.URL.Path, "/device"):
			atomic.AddInt32(&deviceHits, 1)
			// 验证页故意给个不在名单里的主机
			_, _ = w.Write([]byte(`{"device_code":"dc-secret","user_code":"ABCD-EFGH","verification_uri":"https://evil.example/verify","expires_in":900,"interval":5}`))
		case strings.HasSuffix(r.URL.Path, "/token"):
			n := atomic.AddInt32(&tokenHits, 1)
			switch n {
			case 1:
				_, _ = w.Write([]byte(`{"error":"authorization_pending"}`))
			case 2:
				_, _ = w.Write([]byte(`{"error":"slow_down"}`))
			default:
				_, _ = w.Write([]byte(`{"access_token":"at-1","refresh_token":"rt-1","id_token":"` + fakeIDToken("grok@example.com") + `","expires_in":3600,"scope":"openid profile email offline_access grok-cli:access api:access"}`))
			}
		case strings.HasSuffix(r.URL.Path, "/userinfo"):
			atomic.AddInt32(&userinfoHits, 1)
			_, _ = w.Write([]byte(`{"sub":"u-1","email":"grok@example.com"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	client, _ := newTestXaiClient(t, "127.0.0.1")
	client.issuer = server.URL

	challenge, sessionID, err := client.startDeviceLogin()
	if err != nil {
		t.Fatalf("startDeviceLogin: %v", err)
	}
	if challenge.UserCode != "ABCD-EFGH" {
		t.Fatalf("user code = %q", challenge.UserCode)
	}
	// 验证页主机不在名单 → 回落固定官方页
	if challenge.VerificationURI != xaiFallbackVerify {
		t.Fatalf("verification uri = %q, want fallback %q", challenge.VerificationURI, xaiFallbackVerify)
	}

	// 第一次轮询：pending
	result, err := XaiPollDeviceLogin(sessionID)
	if err != nil || result.Status != "pending" {
		t.Fatalf("first poll = %+v, %v", result, err)
	}
	// 未到间隔：本地返回等待，不再打服务端
	before := atomic.LoadInt32(&tokenHits)
	result, err = XaiPollDeviceLogin(sessionID)
	if err != nil || result.Status != "pending" {
		t.Fatalf("interval poll = %+v, %v", result, err)
	}
	if atomic.LoadInt32(&tokenHits) != before {
		t.Fatalf("poll inside interval must not hit the server")
	}

	// 放开间隔后再轮询：slow_down → tokens
	xaiLoginMu.Lock()
	xaiLoginSessions[sessionID].nextPollAt = time.Now()
	xaiLoginMu.Unlock()
	result, err = XaiPollDeviceLogin(sessionID)
	if err != nil || result.Status != "pending" {
		t.Fatalf("slow_down poll = %+v, %v", result, err)
	}
	xaiLoginMu.Lock()
	xaiLoginSessions[sessionID].nextPollAt = time.Now()
	xaiLoginMu.Unlock()
	result, err = XaiPollDeviceLogin(sessionID)
	if err != nil {
		t.Fatalf("tokens poll: %v", err)
	}
	if result.Status != "success" || result.Key == nil {
		t.Fatalf("tokens poll = %+v", result)
	}
	if result.Key.AccessToken != "at-1" || result.Key.RefreshToken != "rt-1" {
		t.Fatalf("tokens = %+v", result.Key)
	}
	if result.Key.Email != "grok@example.com" {
		t.Fatalf("email = %q", result.Key.Email)
	}
	if !xaiHasSubscriptionScope(result.Key.Scopes) {
		t.Fatalf("scopes missing subscription permission: %v", result.Key.Scopes)
	}
	// 成功后会话即弃
	if _, err := XaiPollDeviceLogin(sessionID); err == nil {
		t.Fatalf("session must be dropped after success")
	}
	if atomic.LoadInt32(&deviceHits) != 1 {
		t.Fatalf("device endpoint hits = %d", deviceHits)
	}
	if atomic.LoadInt32(&userinfoHits) == 0 {
		t.Fatalf("userinfo should be used for the account label")
	}
}

func TestXaiPollFailures(t *testing.T) {
	cases := []struct {
		name       string
		body       string
		status     int
		wantReason string
	}{
		{name: "denied", body: `{"error":"access_denied"}`, status: http.StatusOK, wantReason: XaiFailDenied},
		{name: "expired", body: `{"error":"expired_token"}`, status: http.StatusOK, wantReason: XaiFailExpired},
		{name: "server rejected", body: `{"error":"invalid_client"}`, status: http.StatusOK, wantReason: XaiFailRejected},
		{name: "http error", body: `{}`, status: http.StatusBadRequest, wantReason: XaiFailRejected},
		{name: "no subscription scope", body: `{"access_token":"at","scope":"openid profile email"}`, status: http.StatusOK, wantReason: XaiFailNoSubscription},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()

			client, _ := newTestXaiClient(t, "127.0.0.1")
			client.issuer = server.URL
			session := &xaiLoginSession{
				id:          "sess-" + tc.name,
				client:      client,
				deviceCode:  "dc",
				tokenURL:    server.URL + "/token",
				intervalSec: 1,
				expiresAt:   time.Now().Add(time.Minute),
			}
			xaiLoginMu.Lock()
			xaiLoginSessions[session.id] = session
			xaiLoginMu.Unlock()
			defer xaiDropSession(session.id)

			result, err := XaiPollDeviceLogin(session.id)
			if err != nil {
				t.Fatalf("poll: %v", err)
			}
			if result.Status != "failed" {
				t.Fatalf("status = %q, want failed", result.Status)
			}
			if result.Failure == nil || result.Failure.Reason != tc.wantReason {
				t.Fatalf("failure = %+v, want reason %q", result.Failure, tc.wantReason)
			}
			// 失败后会话即弃
			if _, err := XaiPollDeviceLogin(session.id); err == nil {
				t.Fatalf("session must be dropped after failure")
			}
		})
	}
}

func TestXaiPollUnknownSession(t *testing.T) {
	if _, err := XaiPollDeviceLogin("no-such-session"); err == nil {
		t.Fatalf("unknown session must error")
	}
}

func TestXaiPollNetworkFailures(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 直接断开，制造网络错误
		if hj, ok := w.(http.Hijacker); ok {
			conn, _, _ := hj.Hijack()
			_ = conn.Close()
		}
	}))
	defer server.Close()

	client, _ := newTestXaiClient(t, "127.0.0.1")
	session := &xaiLoginSession{
		id:          "sess-net",
		client:      client,
		deviceCode:  "dc",
		tokenURL:    server.URL + "/token",
		intervalSec: 0,
		expiresAt:   time.Now().Add(time.Minute),
	}
	xaiLoginMu.Lock()
	xaiLoginSessions[session.id] = session
	xaiLoginMu.Unlock()
	defer xaiDropSession(session.id)

	var last *XaiPollResult
	for i := 0; i < xaiMaxPollFailures+1; i++ {
		xaiLoginMu.Lock()
		session.nextPollAt = time.Now()
		xaiLoginMu.Unlock()
		result, err := XaiPollDeviceLogin(session.id)
		if err != nil {
			t.Fatalf("poll %d: %v", i, err)
		}
		last = result
		if result.Status == "failed" {
			if result.Failure == nil || result.Failure.Reason != XaiFailNetwork {
				t.Fatalf("failure = %+v, want network", result.Failure)
			}
			return
		}
	}
	t.Fatalf("network failures must eventually fail, last = %+v", last)
}

func TestXaiRefresh(t *testing.T) {
	cases := []struct {
		name       string
		body       string
		status     int
		wantTerm   bool
		wantErr    bool
		wantAccess string
	}{
		{name: "ok", body: `{"access_token":"at-2","refresh_token":"rt-2","expires_in":7200}`, status: http.StatusOK, wantAccess: "at-2"},
		{name: "invalid_grant is terminal", body: `{"error":"invalid_grant"}`, status: http.StatusBadRequest, wantTerm: true},
		{name: "401 is terminal", body: `{}`, status: http.StatusUnauthorized, wantTerm: true},
		{name: "server error is temporary", body: `{}`, status: http.StatusInternalServerError, wantErr: true},
		{name: "temporary reject is not terminal", body: `{"error":"temporarily_unavailable"}`, status: http.StatusBadRequest, wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()

			client, _ := newTestXaiClient(t, "127.0.0.1")
			key := &XaiOAuthKey{AccessToken: "at-1", RefreshToken: "rt-1", TokenURL: server.URL + "/token", Issuer: server.URL}
			next, err := client.refresh(context.Background(), key)
			if tc.wantTerm {
				if err != ErrXaiRefreshTerminal {
					t.Fatalf("err = %v, want ErrXaiRefreshTerminal", err)
				}
				return
			}
			if tc.wantErr {
				if err == nil {
					t.Fatalf("want error")
				}
				if err == ErrXaiRefreshTerminal {
					t.Fatalf("temporary failure must not be terminal")
				}
				return
			}
			if err != nil {
				t.Fatalf("refresh: %v", err)
			}
			if next.AccessToken != tc.wantAccess {
				t.Fatalf("access token = %q, want %q", next.AccessToken, tc.wantAccess)
			}
			if next.RefreshToken != "rt-2" {
				t.Fatalf("refresh token = %q", next.RefreshToken)
			}
			if next.LastRefresh == "" {
				t.Fatalf("last_refresh must be set")
			}
			// 原 key 不被改动
			if key.AccessToken != "at-1" {
				t.Fatalf("original key mutated: %+v", key)
			}
		})
	}
}

func TestXaiRefreshRejectsForeignTokenURL(t *testing.T) {
	client, _ := newTestXaiClient(t, "127.0.0.1")
	key := &XaiOAuthKey{AccessToken: "at", RefreshToken: "rt", TokenURL: "https://evil.example/token"}
	if _, err := client.refresh(context.Background(), key); err != ErrXaiIssuer {
		t.Fatalf("err = %v, want ErrXaiIssuer", err)
	}
}

func TestXaiRefreshWithoutRefreshToken(t *testing.T) {
	client, _ := newTestXaiClient(t, "127.0.0.1")
	if _, err := client.refresh(context.Background(), &XaiOAuthKey{AccessToken: "at"}); err != ErrXaiRefreshTerminal {
		t.Fatalf("err = %v, want ErrXaiRefreshTerminal", err)
	}
}

func TestParseXaiOAuthKey(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		wantErr bool
	}{
		{name: "empty", raw: "", wantErr: true},
		{name: "not json", raw: "sk-xxx", wantErr: true},
		{name: "missing access_token", raw: `{"refresh_token":"rt"}`, wantErr: true},
		{name: "ok", raw: `{"access_token":"at","refresh_token":"rt"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			key, err := ParseXaiOAuthKey(tc.raw)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("want error")
				}
				return
			}
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			if key.AccessToken != "at" {
				t.Fatalf("access token = %q", key.AccessToken)
			}
		})
	}
}

func TestXaiOAuthKeyExpired(t *testing.T) {
	now := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		key  *XaiOAuthKey
		want bool
	}{
		{name: "nil key", key: nil, want: false},
		{name: "no expiry", key: &XaiOAuthKey{}, want: false},
		{name: "future", key: &XaiOAuthKey{ExpiresAt: "2026-11-04T13:00:00Z"}, want: false},
		{name: "past", key: &XaiOAuthKey{ExpiresAt: "2026-11-04T11:00:00Z"}, want: true},
		{name: "unparseable", key: &XaiOAuthKey{ExpiresAt: "not-a-time"}, want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := XaiOAuthKeyExpired(tc.key, now); got != tc.want {
				t.Fatalf("XaiOAuthKeyExpired = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestXaiEmailFromIDToken(t *testing.T) {
	if _, ok := xaiEmailFromIDToken("not-a-jwt"); ok {
		t.Fatalf("malformed token must fail")
	}
	email, ok := xaiEmailFromIDToken(fakeIDToken("a@b.c"))
	if !ok || email != "a@b.c" {
		t.Fatalf("email = %q, %v", email, ok)
	}
}

// fakeIDToken 造一个只解声明、不验签的 ID 令牌（与生产读取方式一致）。
func fakeIDToken(email string) string {
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"u-1","email":"` + email + `"}`))
	return "header." + payload + ".signature"
}

func serverURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func TestXaiRefreshTokenWithProxy(t *testing.T) {
	// 代理地址不可用时退回默认客户端，不能 panic，也不能把令牌发出去
	key := &XaiOAuthKey{AccessToken: "at", RefreshToken: "rt", TokenURL: "https://auth.x.ai/oauth2/token"}
	if _, err := XaiRefreshTokenWithProxy(context.Background(), key, "://not-a-url", dto.ChannelSettings{}); err == nil {
		t.Fatalf("unreachable upstream must fail")
	}
	// 空代理与 XaiRefreshToken 行为一致（缺刷新令牌即终局）
	if _, err := XaiRefreshTokenWithProxy(context.Background(), &XaiOAuthKey{AccessToken: "at"}, "", dto.ChannelSettings{}); err != ErrXaiRefreshTerminal {
		t.Fatalf("err = %v, want ErrXaiRefreshTerminal", err)
	}
	// 主机不在白名单的令牌地址一律拒绝，与走不走代理无关
	foreign := &XaiOAuthKey{AccessToken: "at", RefreshToken: "rt", TokenURL: "https://evil.example/token"}
	if _, err := XaiRefreshTokenWithProxy(context.Background(), foreign, "", dto.ChannelSettings{}); err != ErrXaiIssuer {
		t.Fatalf("err = %v, want ErrXaiIssuer", err)
	}
}
