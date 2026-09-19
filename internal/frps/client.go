package frps

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Connection struct {
	BaseURL       string
	Username      string
	Password      string
	SkipTLSVerify bool
}

type Snapshot struct {
	ServerInfo  map[string]any `json:"server_info"`
	Clients     any            `json:"clients,omitempty"`
	Proxies     map[string]any `json:"proxies"`
	APIMode     string         `json:"api_mode"`
	Warnings    []string       `json:"warnings,omitempty"`
	RefreshedAt string         `json:"refreshed_at"`
}

type TestResult struct {
	OK      bool   `json:"ok"`
	Version string `json:"version,omitempty"`
	Message string `json:"message"`
}

type Client struct {
	baseURL  string
	username string
	password string
	http     *http.Client
}

func NormalizeBaseURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("Dashboard 地址不能为空")
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("Dashboard 地址无效: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", errors.New("Dashboard 地址只支持 http:// 或 https://")
	}
	if u.Host == "" {
		return "", errors.New("Dashboard 地址缺少主机名或 IP")
	}
	if u.User != nil {
		return "", errors.New("请不要把账号密码写进 Dashboard 地址")
	}
	u.Path = strings.TrimRight(u.Path, "/")
	u.RawQuery = ""
	u.Fragment = ""
	return strings.TrimRight(u.String(), "/"), nil
}

func New(connection Connection) (*Client, error) {
	baseURL, err := NormalizeBaseURL(connection.BaseURL)
	if err != nil {
		return nil, err
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if connection.SkipTLSVerify {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec -- explicit per-connection option for private/self-signed dashboards.
	}
	return &Client{
		baseURL:  baseURL,
		username: strings.TrimSpace(connection.Username),
		password: connection.Password,
		http:     &http.Client{Transport: transport, Timeout: 10 * time.Second},
	}, nil
}

func (c *Client) Test(ctx context.Context) (TestResult, error) {
	var info map[string]any
	if err := c.getJSON(ctx, "/api/serverinfo", &info); err != nil {
		return TestResult{}, err
	}
	version := stringValue(info["version"])
	message := "连接成功"
	if version != "" {
		message += " · frps " + version
	}
	return TestResult{OK: true, Version: version, Message: message}, nil
}

func (c *Client) Snapshot(ctx context.Context) (Snapshot, error) {
	var serverInfo map[string]any
	if err := c.getJSON(ctx, "/api/serverinfo", &serverInfo); err != nil {
		return Snapshot{}, err
	}

	result := Snapshot{
		ServerInfo:  serverInfo,
		Proxies:     map[string]any{},
		APIMode:     "legacy",
		RefreshedAt: time.Now().Format(time.RFC3339),
	}

	clientAPIAvailable := false
	var clients any
	if ok, err := c.getOptionalJSON(ctx, "/api/clients", &clients); err != nil {
		result.Warnings = append(result.Warnings, "客户端列表: "+err.Error())
	} else if ok {
		result.Clients = clients
		clientAPIAvailable = true
	}

	proxyAPIAvailable := false
	for _, proxyType := range []string{"tcp", "udp", "http", "https", "tcpmux", "stcp", "sudp", "xtcp"} {
		var payload any
		ok, err := c.getOptionalJSON(ctx, "/api/proxy/"+proxyType, &payload)
		if err != nil {
			result.Warnings = append(result.Warnings, proxyType+" 代理: "+err.Error())
			continue
		}
		if ok {
			result.Proxies[proxyType] = payload
			proxyAPIAvailable = true
		}
	}

	switch {
	case clientAPIAvailable && proxyAPIAvailable:
		result.APIMode = "hybrid"
	case clientAPIAvailable:
		result.APIMode = "clients"
	case proxyAPIAvailable:
		result.APIMode = "proxy"
	default:
		result.APIMode = "serverinfo"
	}
	return result, nil
}

func (c *Client) getOptionalJSON(ctx context.Context, path string, target any) (bool, error) {
	status, body, err := c.do(ctx, path)
	if err != nil {
		return false, err
	}
	if status == http.StatusNotFound || status == http.StatusMethodNotAllowed {
		return false, nil
	}
	if status < 200 || status >= 300 {
		return false, responseError(status, body)
	}
	if err := json.Unmarshal(body, target); err != nil {
		return false, fmt.Errorf("解析 %s 返回失败: %w", path, err)
	}
	return true, nil
}

func (c *Client) getJSON(ctx context.Context, path string, target any) error {
	status, body, err := c.do(ctx, path)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return responseError(status, body)
	}
	if err := json.Unmarshal(body, target); err != nil {
		return fmt.Errorf("解析 %s 返回失败: %w", path, err)
	}
	return nil
}

func (c *Client) do(ctx context.Context, path string) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Accept", "application/json")
	if c.username != "" || c.password != "" {
		req.SetBasicAuth(c.username, c.password)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("连接 FRPS Dashboard 失败: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return 0, nil, err
	}
	return resp.StatusCode, body, nil
}

func responseError(status int, body []byte) error {
	switch status {
	case http.StatusUnauthorized:
		return errors.New("认证失败，请检查 Dashboard 账号和密码")
	case http.StatusForbidden:
		return errors.New("Dashboard 拒绝访问")
	}
	text := strings.TrimSpace(string(body))
	if len(text) > 240 {
		text = text[:240] + "…"
	}
	if text == "" {
		return fmt.Errorf("Dashboard 返回 HTTP %d", status)
	}
	return fmt.Errorf("Dashboard 返回 HTTP %d: %s", status, text)
}

func stringValue(value any) string {
	switch v := value.(type) {
	case string:
		return v
	default:
		return fmt.Sprint(v)
	}
}
