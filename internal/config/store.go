package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	kitpaths "github.com/wanstu/wails-desktop-kit/paths"
)

const AppID = "frp-service-manager"

type Connection struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	BaseURL       string `json:"base_url"`
	Username      string `json:"username"`
	CredentialRef string `json:"credential_ref,omitempty"`
	SkipTLSVerify bool   `json:"skip_tls_verify,omitempty"`
}

type Settings struct {
	ActiveConnectionID string       `json:"active_connection_id,omitempty"`
	Connections        []Connection `json:"connections"`
}

type Store struct {
	mu   sync.Mutex
	dir  string
	path string
}

func NewStore() (*Store, error) {
	dir, err := kitpaths.EnsureConfigDir(AppID)
	if err != nil {
		return nil, err
	}
	return &Store{dir: dir, path: filepath.Join(dir, "settings.json")}, nil
}

func (s *Store) Dir() string { return s.dir }

func (s *Store) Load() (Settings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return Settings{Connections: []Connection{}}, nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("读取设置失败: %w", err)
	}
	var settings Settings
	if err := json.Unmarshal(data, &settings); err != nil {
		return Settings{}, fmt.Errorf("解析设置失败: %w", err)
	}
	if settings.Connections == nil {
		settings.Connections = []Connection{}
	}
	return settings, nil
}

func (s *Store) Save(settings Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if settings.Connections == nil {
		settings.Connections = []Connection{}
	}
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return fmt.Errorf("编码设置失败: %w", err)
	}
	data = append(data, '\n')
	tmp, err := os.CreateTemp(s.dir, ".settings-*.tmp")
	if err != nil {
		return fmt.Errorf("创建临时设置文件失败: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, s.path); err != nil {
		return fmt.Errorf("保存设置失败: %w", err)
	}
	return nil
}

func (s *Store) Find(settings Settings, id string) (Connection, int, error) {
	id = strings.TrimSpace(id)
	for i, c := range settings.Connections {
		if c.ID == id {
			return c, i, nil
		}
	}
	return Connection{}, -1, fmt.Errorf("连接 %q 不存在", id)
}

func NewConnectionID() (string, error) {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "frps_" + hex.EncodeToString(buf), nil
}
