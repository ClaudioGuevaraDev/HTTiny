package updates

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

// Detached so the helper outlives this process, and in its own group so the
// console signals that end HTTiny never reach it.
const (
	detachedProcess       = 0x00000008
	createNewProcessGroup = 0x00000200
)

// apply runs the downloaded NSIS installer rather than swapping the executable.
//
// Running the installer is what keeps the Add/Remove Programs entry, the Start
// Menu shortcut and the uninstaller describing the version actually on disk; a
// binary swap updates the bytes and leaves every one of those stale forever.
//
// The catch is that Windows will not let the installer overwrite an executable
// that is still running, and this process cannot both launch it and already be
// gone. So a detached PowerShell waits for our PID to disappear and only then
// starts the installer silently — the same shape as the helper Wails spawns for
// its own swap, minus the file juggling we do not need.
func apply(_ context.Context, _ *updater.Updater, staged string) error {
	script := fmt.Sprintf(
		"Wait-Process -Id %d -Timeout 60 -ErrorAction SilentlyContinue; Start-Process -FilePath %s -ArgumentList '/S'",
		os.Getpid(), quoteForPowerShell(staged),
	)

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: detachedProcess | createNewProcessGroup,
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("spawn installer helper: %w", err)
	}
	// Release the handle so this process can exit without waiting on a child that
	// is deliberately outliving it.
	if err := cmd.Process.Release(); err != nil {
		return fmt.Errorf("release installer helper: %w", err)
	}

	// Quitting is the trigger: the helper is already blocked on this PID.
	if app := application.Get(); app != nil {
		app.Quit()
	}
	return nil
}

// quoteForPowerShell wraps a path as a single-quoted PowerShell literal, where
// the only escape is a doubled quote and nothing else is interpreted. Installer
// paths land under the user profile, so a name with an apostrophe is entirely
// possible.
func quoteForPowerShell(path string) string {
	return "'" + strings.ReplaceAll(path, "'", "''") + "'"
}
