// Package updates checks for, downloads and applies new versions of HTTiny.
//
// The split of responsibilities is deliberate. Wails' updater does the delicate
// half — fetching the manifest, comparing semver, streaming the download and
// verifying the Ed25519 signature against a key pinned at build time — and this
// package decides what "apply" means on each platform, because that updater only
// ever replaces an executable or a bundle and never runs an installer.
//
// Windows therefore reuses the NSIS installer we already publish, so the entry in
// Add/Remove Programs, the shortcuts and the uninstaller all stay consistent;
// swapping the .exe would leave every one of them describing the old version
// forever. macOS gets the bundle swap the updater is built for. Linux never
// downloads at all: a .deb or .rpm lives in root-owned paths, and the packages we
// ship are the package manager's business, so the frontend sends people to the
// download page instead.
package updates

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/endpoint"
)

// manifestURL is the signed manifest describing the latest release. It is served
// from the release itself, so publishing a release publishes the update.
const manifestURL = "https://github.com/ClaudioGuevaraDev/httiny/releases/latest/download/manifest.json"

// DownloadPage is where the frontend sends people when an update cannot be
// applied in place. The GitHub release carries every installer, so this works
// today; point it at the landing page once one exists.
const DownloadPage = "https://github.com/ClaudioGuevaraDev/httiny/releases/latest"

// Error codes crossing the binding. Like httpexec, this service reports a stable
// machine-readable code rather than a marshalled Go error, because the frontend
// has to tell "nothing to do" apart from "could not find out".
const (
	codeUnavailable   = "UPDATE_UNAVAILABLE"
	codeCheckFailed   = "UPDATE_CHECK_FAILED"
	codeDownloadFail  = "UPDATE_DOWNLOAD_FAILED"
	codeApplyFailed   = "UPDATE_APPLY_FAILED"
	codeNotSupported  = "UPDATE_NOT_SUPPORTED"
	codeNothingStaged = "UPDATE_NOT_READY"
)

// Update describes a release newer than the running one.
type Update struct {
	Version string `json:"version"`
	Notes   string `json:"notes"`
	// CanSelfUpdate is false where the frontend must offer a manual download
	// instead of an install button.
	CanSelfUpdate bool `json:"canSelfUpdate"`
}

// Result mirrors httpexec.Result: a union the frontend can branch on without
// parsing prose. Update is nil when the app is already up to date.
type Result struct {
	OK        bool    `json:"ok"`
	ErrorCode string  `json:"errorCode"`
	ErrorText string  `json:"errorText"`
	Update    *Update `json:"update"`
}

func ok(u *Update) Result { return Result{OK: true, Update: u} }
func fail(code string, err error) Result {
	text := ""
	if err != nil {
		text = err.Error()
	}
	return Result{ErrorCode: code, ErrorText: text}
}

// Service is the bound service. It is registered through application.NewService
// so the bindings generator can see it.
type Service struct {
	version string
	key     []byte

	once    sync.Once
	initErr error
}

// New builds the service from the two files main.go embeds: the frontend's
// package.json, which is the same version source Vite compiles into
// __APP_VERSION__, and the pinned public key.
//
// Reading the version from package.json rather than a constant matters: the
// release procedure already keeps that file in step with build/config.yml and CI
// refuses to build when the tag disagrees, so this cannot drift on its own.
func New(packageJSON, publicKey []byte) *Service {
	return &Service{version: versionFrom(packageJSON), key: publicKey}
}

func versionFrom(packageJSON []byte) string {
	var pkg struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(packageJSON, &pkg); err != nil {
		return ""
	}
	return pkg.Version
}

// ServiceName is what Wails shows in logs.
func (s *Service) ServiceName() string { return "updates" }

// updaterFor configures the Wails updater once, on first use. It cannot happen in
// New: the updater hangs off the application, which does not exist until
// application.New has returned.
func (s *Service) updaterFor() (*updater.Updater, error) {
	app := application.Get()
	if app == nil || app.Updater == nil {
		return nil, errors.New("updater unavailable")
	}
	s.once.Do(func() {
		if s.version == "" {
			s.initErr = errors.New("could not read the running version")
			return
		}
		provider, err := endpoint.New(endpoint.Config{URL: manifestURL})
		if err != nil {
			s.initErr = err
			return
		}
		s.initErr = app.Updater.Init(updater.Config{
			CurrentVersion: s.version,
			Providers:      []updater.Provider{provider},
			PublicKey:      s.key,
			// Headless: the modal is ours, built from the app's own components.
			// Without this the updater would open a second window of its own.
			Window: updater.WindowNone,
			// No polling. The check runs once at startup, from the frontend.
			CheckInterval: 0,
		})
	})
	if s.initErr != nil {
		return nil, s.initErr
	}
	return app.Updater, nil
}

// CurrentVersion reports the running version, so the frontend can show what it
// would be upgrading from without trusting its own build-time constant.
func (s *Service) CurrentVersion() string { return s.version }

// CanSelfUpdate reports whether Apply can do anything on this platform.
func (s *Service) CanSelfUpdate() bool { return canSelfUpdate() }

// Check asks the manifest whether anything newer exists. A nil Update with OK
// means the app is current; that is the common case and the frontend shows
// nothing for it.
//
// ctx is first so the binding is context-aware and the call can be cancelled from
// the frontend, the same rule httpexec.Send follows.
func (s *Service) Check(ctx context.Context) Result {
	up, err := s.updaterFor()
	if err != nil {
		return fail(codeUnavailable, err)
	}
	release, err := up.Check(ctx)
	if err != nil {
		return fail(codeCheckFailed, err)
	}
	if release == nil {
		return ok(nil)
	}
	return ok(&Update{
		Version:       release.Version,
		Notes:         release.Notes,
		CanSelfUpdate: canSelfUpdate(),
	})
}

// Download fetches and verifies the release found by Check, leaving it staged on
// disk. It deliberately stops short of applying: the user is asked before
// anything restarts.
func (s *Service) Download(ctx context.Context) Result {
	if !canSelfUpdate() {
		return fail(codeNotSupported, errors.New("this installation cannot update itself"))
	}
	up, err := s.updaterFor()
	if err != nil {
		return fail(codeUnavailable, err)
	}
	if err := up.DownloadAndInstall(ctx); err != nil {
		return fail(codeDownloadFail, err)
	}
	return ok(nil)
}

// Apply installs what Download staged and ends the running process. Anything it
// returns is a failure — on success the app is on its way out.
func (s *Service) Apply(ctx context.Context) Result {
	if !canSelfUpdate() {
		return fail(codeNotSupported, errors.New("this installation cannot update itself"))
	}
	up, err := s.updaterFor()
	if err != nil {
		return fail(codeUnavailable, err)
	}
	staged := up.DownloadedPath()
	if staged == "" {
		return fail(codeNothingStaged, errors.New("no update has been downloaded"))
	}
	if err := apply(ctx, up, staged); err != nil {
		return fail(codeApplyFailed, err)
	}
	return ok(nil)
}

// OpenDownloadPage opens the releases page in the user's browser. It is the only
// path offered on Linux, and the fallback everywhere else when something fails.
func (s *Service) OpenDownloadPage() Result {
	app := application.Get()
	if app == nil || app.Browser == nil {
		return fail(codeUnavailable, errors.New("browser unavailable"))
	}
	if err := app.Browser.OpenURL(DownloadPage); err != nil {
		return fail(codeApplyFailed, fmt.Errorf("open %s: %w", DownloadPage, err))
	}
	return ok(nil)
}

// canSelfUpdate is false on Linux for every package we ship. A .deb or .rpm
// installs into root-owned paths, and while an AppImage can in principle replace
// itself, it is one self-contained file rather than the loose executable the
// updater expects to swap — so Linux always takes the manual route.
func canSelfUpdate() bool { return runtime.GOOS != "linux" }
