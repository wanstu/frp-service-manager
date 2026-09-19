package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/wanstu/wails-desktop-kit/jsonstore"
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
	dir    string
	values *jsonstore.Store[Settings]
}

func NewStore() (*Store, error) {
	dir, err := kitpaths.EnsureConfigDir(AppID)
	if err != nil {
		return nil, err
	}
	values := jsonstore.New(filepath.Join(dir, "settings.json"), jsonstore.Options[Settings]{
		Default: func() Settings {
			return Settings{Connections: []Connection{}}
		},
		Normalize: func(settings *Settings) {
			if settings.Connections == nil {
				settings.Connections = []Connection{}
			}
		},
	})
	return &Store{dir: dir, values: values}, nil
}

func (s *Store) Dir() string { return s.dir }

func (s *Store) Load() (Settings, error) {
	settings, err := s.values.Load()
	if err != nil {
		return Settings{}, fmt.Errorf("读取设置失败: %w", err)
	}
	return settings, nil
}

func (s *Store) Save(settings Settings) error {
	if err := s.values.Save(settings); err != nil {
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
