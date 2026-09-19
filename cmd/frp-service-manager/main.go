package main

import (
	"embed"
	"fmt"
	"io/fs"
	"os"

	"frp-service-manager/internal/config"

	desktopkit "github.com/wanstu/wails-desktop-kit"
	kitui "github.com/wanstu/wails-desktop-kit/ui"
)

//go:embed all:frontend
var embeddedFrontend embed.FS

//go:embed assets/appicon.png
var appIcon []byte

func main() {
	launch, err := desktopkit.ParseLaunchOptions(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, "frp-service-manager:", err)
		os.Exit(1)
	}
	app, err := NewApp()
	if err != nil {
		fmt.Fprintln(os.Stderr, "frp-service-manager:", err)
		os.Exit(1)
	}
	if err := runDesktop(app, launch); err != nil {
		fmt.Fprintln(os.Stderr, "frp-service-manager:", err)
		os.Exit(1)
	}
}

func runDesktop(app *App, launch desktopkit.LaunchOptions) error {
	assets, err := fs.Sub(embeddedFrontend, "frontend")
	if err != nil {
		return err
	}

	window := desktopkit.DefaultWindowConfig()
	window.Width = 1180
	window.Height = 760
	window.MinWidth = 920
	window.MinHeight = 620
	window.HidePolicy = desktopkit.HideSafe
	window.StartHiddenOnAutoStart = true
	window.Background = desktopkit.Color{R: 245, G: 247, B: 250, A: 1}

	openDashboard := desktopkit.Action("打开当前 FRPS Dashboard", func(*desktopkit.Controller) error {
		state, err := app.GetState()
		if err != nil {
			return err
		}
		if state.ActiveConnectionID == "" {
			return nil
		}
		return app.OpenDashboard(state.ActiveConnectionID)
	})

	return desktopkit.Run(desktopkit.Config{
		ID:             config.AppID,
		Title:          "FRP Service Manager",
		Assets:         kitui.Mount(assets),
		Theme:          desktopkit.DefaultThemeConfig(),
		Bind:           []interface{}{app},
		Launch:         launch,
		Window:         window,
		SingleInstance: true,
		Tray: desktopkit.TrayConfig{
			Enabled:            true,
			Icon:               appIcon,
			AutoStart:          app.launchAtLogin,
			LaunchAtLoginLabel: "开机启动管理器",
			Items:              []desktopkit.TrayItem{openDashboard},
		},
		Hooks: desktopkit.Hooks{
			Startup:  app.startup,
			Shutdown: app.shutdown,
		},
	})
}
