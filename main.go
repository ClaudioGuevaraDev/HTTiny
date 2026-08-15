package main

import (
	"embed"
	"log"

	"github.com/ClaudioGuevaraDev/httiny/internal/httpexec"
	"github.com/ClaudioGuevaraDev/httiny/internal/workspace"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := application.New(application.Options{
		Name:        "HTTiny",
		Description: "A tiny, focused HTTP client for developers.",
		// Bound services. The bindings generator detects the type argument of
		// application.NewService statically, so services must be registered
		// through that call for `wails3 generate bindings` to see them.
		Services: []application.Service{
			application.NewService(httpexec.New()),
			application.NewService(workspace.New()),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
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
	})
	window.Center()
	window.Show()

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
