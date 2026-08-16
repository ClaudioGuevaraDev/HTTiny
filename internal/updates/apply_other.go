//go:build !windows

package updates

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

// apply on macOS hands over to the updater, which swaps the whole `.app` bundle
// and relaunches through `open`. The bundle is the unit here, not the executable
// inside it: the icon, Info.plist and the ad-hoc signature all belong to the
// directory, so replacing only the binary would leave an app describing the old
// version.
//
// Linux never reaches this function. canSelfUpdate is false there, so Apply
// refuses before anything is staged and the frontend offers the download page.
func apply(ctx context.Context, up *updater.Updater, _ string) error {
	return up.Restart(ctx)
}
