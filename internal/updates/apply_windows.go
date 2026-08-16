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

// No window so nothing flashes on screen, and its own process group so the console
// signals that end HTTiny never reach it.
//
// Deliberately NOT DETACHED_PROCESS, which is the obvious-looking choice and is
// wrong: it leaves the child with no console at all, and powershell.exe is a
// console application that dies on startup without one. The helper was being
// created and then vanishing before it ran a single statement.
const (
	createNoWindow        = 0x08000000
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
// gone. So a helper waits for our PID to disappear, installs, and only then
// relaunches — the same shape as the helper Wails spawns for its own swap, minus
// the file juggling we do not need.
//
// The relaunch is what makes "Install and restart" true. `-Wait` on the installer
// is load-bearing for it: without it the new executable is started while the old
// one is still being overwritten.
func apply(_ context.Context, _ *updater.Updater, staged string) error {
	// The path we are running from is the one the installer is about to replace,
	// so it is also the one to come back up on. Falling back to no relaunch is
	// better than guessing an install location that may not be where we live.
	relaunch := ""
	if self, err := os.Executable(); err == nil {
		relaunch = fmt.Sprintf("; Start-Process -FilePath %s", quoteForPowerShell(self))
	}

	script := fmt.Sprintf(
		"Wait-Process -Id %d -Timeout 60 -ErrorAction SilentlyContinue; Start-Process -FilePath %s -ArgumentList '/S' -Wait%s",
		os.Getpid(), quoteForPowerShell(staged), relaunch,
	)

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow | createNewProcessGroup,
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
