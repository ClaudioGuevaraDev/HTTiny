package main

import (
	"embed"
	"log"

	"github.com/ClaudioGuevaraDev/httiny/internal/httpexec"
	"github.com/ClaudioGuevaraDev/httiny/internal/updates"
	"github.com/ClaudioGuevaraDev/httiny/internal/workspace"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

// The same PNG the packaging tasks derive the .ico and .icns from. Windows reads
// its icon from the resources linked into the binary and macOS from the .app
// bundle, so this is what gives Linux — which has neither — a window and taskbar
// icon instead of the toolkit's generic one.
//
//go:embed build/appicon.png
var appIcon []byte

// The trust root for updates. Signatures are checked against this key and only
// this key, so a compromised release feed cannot substitute its own — which is
// the entire reason it is pinned at build time rather than fetched.
//
//go:embed build/updater.key.pub
var updaterPublicKey []byte

// The frontend manifest, embedded for its `version` field alone. It is the same
// file Vite reads to define __APP_VERSION__, so the version Go compares against
// the update manifest and the version on screen cannot disagree.
//
//go:embed frontend/package.json
var frontendPackage []byte

func main() {
	// Held in a variable rather than constructed inline: the same instance has to be
	// both a bound service and the asset middleware, because the bytes it retains for
	// a response are what the webview fetches to render an image, a PDF or a video.
	exec := httpexec.New()

	app := application.New(application.Options{
		Name:        "HTTiny",
		Description: "A tiny, focused HTTP client for developers.",
		// Used by the default about box.
		Icon: appIcon,
		// Bound services. The bindings generator detects the type argument of
		// application.NewService statically, so services must be registered
		// through that call for `wails3 generate bindings` to see them.
		Services: []application.Service{
			application.NewService(exec),
			application.NewService(workspace.New()),
			application.NewService(updates.New(frontendPackage, updaterPublicKey)),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
			// Claims one path prefix and delegates everything else, so the bundled
			// frontend — and the Vite dev server behind `wails3 task dev` — is
			// untouched. Wails injects this before its own middlewares.
			Middleware: exec.BodyRoute,
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "HTTiny",
		Width:            1440,
		Height:           900,
		MinWidth:         1024,
		MinHeight:        680,
		BackgroundColour: application.NewRGB(10, 10, 11),
		URL:              "/",
		Linux: application.LinuxWindow{
			Icon: appIcon,
		},
	})
	window.Center()
	window.Show()

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
