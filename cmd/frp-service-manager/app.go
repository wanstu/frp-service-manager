package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"frp-service-manager/internal/config"
	"frp-service-manager/internal/frps"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	kitautostart "github.com/wanstu/wails-desktop-kit/autostart"
	"github.com/wanstu/wails-desktop-kit/secureconfig"
)

type ConnectionInput struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	BaseURL       string `json:"base_url"`
	Username      string `json:"username"`
	Password      string `json:"password"`
	ClearPassword bool   `json:"clear_password"`
	SkipTLSVerify bool   `json:"skip_tls_verify"`
}

type ConnectionView struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	BaseURL       string `json:"base_url"`
	Username      string `json:"username"`
	HasPassword   bool   `json:"has_password"`
	SkipTLSVerify bool   `json:"skip_tls_verify"`
}

type UIState struct {
	Connections            []ConnectionView `json:"connections"`
	ActiveConnectionID     string           `json:"active_connection_id"`
	DataDir                string           `json:"data_dir"`
	LaunchAtLoginSupported bool             `json:"launch_at_login_supported"`
	LaunchAtLogin          bool             `json:"launch_at_login"`
}

type App struct {
	store         *config.Store
	secrets       *secureconfig.Store
	launchAtLogin *kitautostart.Manager

	mu  sync.RWMutex
	ctx context.Context
}

func NewApp() (*App, error) {
	store, err := config.NewStore()
	if err != nil {
		return nil, err
	}
	secrets, err := secureconfig.New(config.AppID)
	if err != nil {
		return nil, err
	}
	launchAtLogin, err := kitautostart.New(kitautostart.Config{
		ID:          config.AppID,
		DisplayName: "FRP Service Manager",
		Comment:     "Manage remote FRPS dashboards",
		Arguments:   []string{"--autostart"},
	})
	if err != nil {
		return nil, err
	}
	return &App{store: store, secrets: secrets, launchAtLogin: launchAtLogin}, nil
}

func (a *App) startup(ctx context.Context) {
	a.mu.Lock()
	a.ctx = ctx
	a.mu.Unlock()
}

func (a *App) shutdown(context.Context) {}

func (a *App) GetState() (UIState, error) {
	settings, err := a.store.Load()
	if err != nil {
		return UIState{}, err
	}
	enabled, err := a.launchAtLogin.Enabled()
	if err != nil {
		return UIState{}, err
	}
	views := make([]ConnectionView, 0, len(settings.Connections))
	for _, connection := range settings.Connections {
		hasPassword := false
		if connection.CredentialRef != "" {
			hasPassword, _ = a.secrets.Exists(connection.CredentialRef)
		}
		views = append(views, ConnectionView{
			ID:            connection.ID,
			Name:          connection.Name,
			BaseURL:       connection.BaseURL,
			Username:      connection.Username,
			HasPassword:   hasPassword,
			SkipTLSVerify: connection.SkipTLSVerify,
		})
	}
	return UIState{
		Connections:            views,
		ActiveConnectionID:     settings.ActiveConnectionID,
		DataDir:                a.store.Dir(),
		LaunchAtLoginSupported: a.launchAtLogin.Supported(),
		LaunchAtLogin:          enabled,
	}, nil
}

func (a *App) SaveConnection(input ConnectionInput) (UIState, error) {
	settings, err := a.store.Load()
	if err != nil {
		return UIState{}, err
	}

	input.ID = strings.TrimSpace(input.ID)
	input.Name = strings.TrimSpace(input.Name)
	input.Username = strings.TrimSpace(input.Username)
	if input.Name == "" {
		input.Name = fmt.Sprintf("FRPS %d", len(settings.Connections)+1)
	}
	baseURL, err := frps.NormalizeBaseURL(input.BaseURL)
	if err != nil {
		return UIState{}, err
	}

	var existing config.Connection
	index := -1
	if input.ID != "" {
		existing, index, err = a.store.Find(settings, input.ID)
		if err != nil {
			return UIState{}, err
		}
	} else {
		input.ID, err = config.NewConnectionID()
		if err != nil {
			return UIState{}, err
		}
	}

	for i, item := range settings.Connections {
		if i != index && strings.EqualFold(strings.TrimSpace(item.Name), input.Name) {
			return UIState{}, fmt.Errorf("连接名称 %q 已存在", input.Name)
		}
	}

	credentialRef := existing.CredentialRef
	if input.ClearPassword {
		if credentialRef != "" {
			if err := a.secrets.Delete(credentialRef); err != nil && !errors.Is(err, secureconfig.ErrNotFound) {
				return UIState{}, err
			}
		}
		credentialRef = ""
	} else if input.Password != "" {
		if credentialRef == "" {
			credentialRef = "connections/" + input.ID + "/password"
		}
		if err := a.secrets.Put(credentialRef, []byte(input.Password)); err != nil {
			return UIState{}, fmt.Errorf("安全保存 Dashboard 密码失败: %w", err)
		}
	}

	connection := config.Connection{
		ID:            input.ID,
		Name:          input.Name,
		BaseURL:       baseURL,
		Username:      input.Username,
		CredentialRef: credentialRef,
		SkipTLSVerify: input.SkipTLSVerify,
	}
	if index >= 0 {
		settings.Connections[index] = connection
	} else {
		settings.Connections = append(settings.Connections, connection)
	}
	if settings.ActiveConnectionID == "" || index < 0 {
		settings.ActiveConnectionID = connection.ID
	}
	if err := a.store.Save(settings); err != nil {
		return UIState{}, err
	}
	return a.GetState()
}

func (a *App) DeleteConnection(id string) (UIState, error) {
	settings, err := a.store.Load()
	if err != nil {
		return UIState{}, err
	}
	connection, index, err := a.store.Find(settings, id)
	if err != nil {
		return UIState{}, err
	}
	if connection.CredentialRef != "" {
		if err := a.secrets.Delete(connection.CredentialRef); err != nil && !errors.Is(err, secureconfig.ErrNotFound) {
			return UIState{}, err
		}
	}
	settings.Connections = append(settings.Connections[:index], settings.Connections[index+1:]...)
	if settings.ActiveConnectionID == id {
		settings.ActiveConnectionID = ""
		if len(settings.Connections) > 0 {
			settings.ActiveConnectionID = settings.Connections[0].ID
		}
	}
	if err := a.store.Save(settings); err != nil {
		return UIState{}, err
	}
	return a.GetState()
}

func (a *App) SetActiveConnection(id string) (UIState, error) {
	settings, err := a.store.Load()
	if err != nil {
		return UIState{}, err
	}
	if _, _, err := a.store.Find(settings, id); err != nil {
		return UIState{}, err
	}
	settings.ActiveConnectionID = id
	if err := a.store.Save(settings); err != nil {
		return UIState{}, err
	}
	return a.GetState()
}

func (a *App) TestConnection(input ConnectionInput) (frps.TestResult, error) {
	password := input.Password
	if password == "" && input.ID != "" && !input.ClearPassword {
		settings, err := a.store.Load()
		if err == nil {
			if saved, _, findErr := a.store.Find(settings, input.ID); findErr == nil {
				password, err = a.passwordFor(saved)
				if err != nil {
					return frps.TestResult{}, err
				}
			}
		}
	}
	client, err := frps.New(frps.Connection{
		BaseURL:       input.BaseURL,
		Username:      input.Username,
		Password:      password,
		SkipTLSVerify: input.SkipTLSVerify,
	})
	if err != nil {
		return frps.TestResult{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	return client.Test(ctx)
}

func (a *App) RefreshConnection(id string) (frps.Snapshot, error) {
	settings, err := a.store.Load()
	if err != nil {
		return frps.Snapshot{}, err
	}
	connection, _, err := a.store.Find(settings, id)
	if err != nil {
		return frps.Snapshot{}, err
	}
	password, err := a.passwordFor(connection)
	if err != nil {
		return frps.Snapshot{}, err
	}
	client, err := frps.New(frps.Connection{
		BaseURL:       connection.BaseURL,
		Username:      connection.Username,
		Password:      password,
		SkipTLSVerify: connection.SkipTLSVerify,
	})
	if err != nil {
		return frps.Snapshot{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return client.Snapshot(ctx)
}

func (a *App) RefreshActiveConnection() (frps.Snapshot, error) {
	settings, err := a.store.Load()
	if err != nil {
		return frps.Snapshot{}, err
	}
	if settings.ActiveConnectionID == "" {
		return frps.Snapshot{}, errors.New("还没有 FRPS 连接")
	}
	return a.RefreshConnection(settings.ActiveConnectionID)
}

func (a *App) OpenDashboard(id string) error {
	settings, err := a.store.Load()
	if err != nil {
		return err
	}
	connection, _, err := a.store.Find(settings, id)
	if err != nil {
		return err
	}
	ctx := a.runtimeContext()
	if ctx == nil {
		return errors.New("桌面运行时尚未就绪")
	}
	wailsruntime.BrowserOpenURL(ctx, connection.BaseURL)
	return nil
}

func (a *App) SetLaunchAtLogin(enabled bool) (UIState, error) {
	if enabled && !a.launchAtLogin.Supported() {
		return UIState{}, errors.New("当前平台不支持开机启动")
	}
	if err := a.launchAtLogin.SetEnabled(enabled); err != nil {
		return UIState{}, err
	}
	return a.GetState()
}

func (a *App) passwordFor(connection config.Connection) (string, error) {
	if connection.CredentialRef == "" {
		return "", nil
	}
	value, err := a.secrets.Get(connection.CredentialRef)
	if errors.Is(err, secureconfig.ErrNotFound) {
		return "", errors.New("该连接保存的密码已丢失，请重新编辑连接并保存密码")
	}
	if err != nil {
		return "", fmt.Errorf("读取 Dashboard 密码失败: %w", err)
	}
	return string(value), nil
}

func (a *App) runtimeContext() context.Context {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.ctx
}
