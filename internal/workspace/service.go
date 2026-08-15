// Package workspace persists the user's collections and session to disk.
//
// The frontend owns the payload schema; this package owns the envelope, atomic
// writes, and recovery. That split is deliberate: a Go mirror of RequestDocument
// would be a second definition of the same shape, drifting out of sync with nothing
// in a test-free project to catch it.
package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/ClaudioGuevaraDev/HTTiny/internal/secrets"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	dirName = "HTTiny"
	// Two files, not one. They differ on portability (collections travel between
	// machines, a window layout should not), on write cadence (dragging the split
	// handle must not rewrite the file holding your requests), and on blast radius
	// (a corrupt layout should never cost you your work).
	workspaceFile = "workspace.json"
	prefsFile     = "ui.json"
	// Overrides the data directory, so `wails3 task dev` need not write over a real
	// workspace.
	dirEnvVar = "HTTINY_DATA_DIR"
)

// envelope is the whole of Go's understanding of a file. Payload stays raw so the
// schema can change with the frontend alone.
type envelope struct {
	Version int             `json:"version"`
	SavedAt string          `json:"savedAt"`
	Payload json.RawMessage `json:"payload"`
}

// LoadResult crosses the binding. Payload is the payload's JSON *text*; the
// frontend parses and validates it.
type LoadResult struct {
	Found   bool   `json:"found"`
	Version int    `json:"version"`
	Payload string `json:"payload"`
	// Set when an unreadable file was moved aside, so the UI can say where it went.
	Quarantined string `json:"quarantined"`
}

// Secret is one request's credentials as they cross the binding.
type Secret struct {
	ID       string `json:"id"`
	Token    string `json:"token"`
	Password string `json:"password"`
}

// SecretsResult reports whether the credential store could be used at all, so the
// UI can tell the user their tokens are session-only instead of silently losing
// them. Failing to reach a keychain must never fail the workspace load.
type SecretsResult struct {
	Available bool     `json:"available"`
	Secrets   []Secret `json:"secrets"`
	Error     string   `json:"error"`
}

type Service struct {
	dir string
	mu  sync.Mutex
}

func New() *Service { return &Service{} }

func (s *Service) ServiceName() string { return "Workspace" }

func (s *Service) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	dir := os.Getenv(dirEnvVar)
	if dir == "" {
		base, err := os.UserConfigDir()
		if err != nil {
			return fmt.Errorf("locate the user config directory: %w", err)
		}
		dir = filepath.Join(base, dirName)
	}
	// 0o700 so other users on the machine cannot read the workspace. Windows
	// ignores the mode; there the protection is the per-user ACL already on
	// %AppData%. Credentials are not in these files either way — see internal/secrets.
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create the data directory %q: %w", dir, err)
	}
	s.dir = dir
	return nil
}

// ServiceShutdown cannot flush anything: the pending payload lives in the frontend,
// never here. Taking the lock makes shutdown wait for an in-flight rename instead of
// racing it and leaving a stray .tmp behind.
func (s *Service) ServiceShutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return nil
}

// DataDir lets the UI tell the user where their collections actually live.
func (s *Service) DataDir(_ context.Context) string { return s.dir }

func (s *Service) LoadWorkspace(_ context.Context) (LoadResult, error) { return s.load(workspaceFile) }

func (s *Service) LoadPrefs(_ context.Context) (LoadResult, error) { return s.load(prefsFile) }

func (s *Service) SaveWorkspace(_ context.Context, payload string, version int) error {
	return s.save(workspaceFile, payload, version)
}

func (s *Service) SavePrefs(_ context.Context, payload string, version int) error {
	return s.save(prefsFile, payload, version)
}

// LoadSecrets fetches credentials for the given request ids in one call rather than
// one round trip each, which matters because this sits on the startup path.
func (s *Service) LoadSecrets(_ context.Context, ids []string) SecretsResult {
	if !secrets.Available() {
		return SecretsResult{Error: "no credential store is available on this system"}
	}
	out := SecretsResult{Available: true, Secrets: make([]Secret, 0, len(ids))}
	for _, id := range ids {
		entry, err := secrets.Get(id)
		if err != nil {
			// One unreadable entry must not cost the others.
			out.Error = err.Error()
			continue
		}
		if entry.Empty() {
			continue
		}
		out.Secrets = append(out.Secrets, Secret{ID: id, Token: entry.Token, Password: entry.Password})
	}
	return out
}

// SaveSecrets writes the given credentials and removes every stored entry whose id
// is not in `keep`, so deleting a request or clearing its token also clears the
// keychain. `keep` is the full set of live request ids.
func (s *Service) SaveSecrets(_ context.Context, entries []Secret, keep []string) SecretsResult {
	if !secrets.Available() {
		return SecretsResult{Error: "no credential store is available on this system"}
	}
	out := SecretsResult{Available: true}

	written := make(map[string]bool, len(entries))
	for _, entry := range entries {
		written[entry.ID] = true
		if err := secrets.Set(entry.ID, secrets.Entry{Token: entry.Token, Password: entry.Password}); err != nil {
			out.Error = err.Error()
		}
	}
	for _, id := range keep {
		if written[id] {
			continue
		}
		if err := secrets.Delete(id); err != nil {
			out.Error = err.Error()
		}
	}
	return out
}

func (s *Service) load(name string) (LoadResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	path := filepath.Join(s.dir, name)
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return LoadResult{Found: false}, nil // first run
	}
	if err != nil {
		return LoadResult{}, fmt.Errorf("read %s: %w", name, err)
	}

	var env envelope
	if err := json.Unmarshal(raw, &env); err != nil || len(env.Payload) == 0 {
		// Still the user's data — most likely a hand edit with a trailing comma.
		// Move it aside so the next autosave cannot overwrite it, and start clean.
		moved, moveErr := s.quarantine(name)
		if moveErr != nil {
			return LoadResult{}, fmt.Errorf("set aside the unreadable %s: %w", name, moveErr)
		}
		return LoadResult{Found: false, Quarantined: moved}, nil
	}

	// One known-good snapshot per session, taken before any write can touch the
	// live file. Copying on every save would be pointless churn.
	_ = os.WriteFile(path+".bak", raw, 0o600)

	return LoadResult{Found: true, Version: env.Version, Payload: string(env.Payload)}, nil
}

func (s *Service) quarantine(name string) (string, error) {
	stamp := time.Now().UTC().Format("20060102-150405")
	target := filepath.Join(s.dir, fmt.Sprintf("%s.corrupt-%s", name, stamp))
	if err := os.Rename(filepath.Join(s.dir, name), target); err != nil {
		return "", err
	}
	return target, nil
}

func (s *Service) save(name, payload string, version int) error {
	if !json.Valid([]byte(payload)) {
		return errors.New("the payload is not valid JSON")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	env := envelope{
		Version: version,
		SavedAt: time.Now().UTC().Format(time.RFC3339),
		Payload: json.RawMessage(payload),
	}
	// Indented because the file is meant to be readable, diffable and hand-editable.
	// RawMessage preserves the frontend's field order, which a map round-trip would
	// replace with alphabetical.
	out, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		return fmt.Errorf("encode %s: %w", name, err)
	}

	// Same directory, so the rename stays on one filesystem and is therefore atomic.
	tmp, err := os.CreateTemp(s.dir, name+".*.tmp")
	if err != nil {
		return fmt.Errorf("create a temporary file for %s: %w", name, err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // a no-op once the rename succeeds

	if _, err := tmp.Write(out); err != nil {
		tmp.Close()
		return fmt.Errorf("write %s: %w", name, err)
	}
	// Sync before rename: without it a power loss can leave a renamed but empty file,
	// which is a worse outcome than the crash itself.
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("flush %s: %w", name, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close %s: %w", name, err)
	}

	return replace(tmpName, filepath.Join(s.dir, name))
}

// replace renames over an existing file. That is atomic on all three platforms, but
// on Windows it can fail with a sharing violation when an antivirus scanner or an
// editor briefly holds the destination open; one retry clears it in practice.
func replace(from, to string) error {
	err := os.Rename(from, to)
	if err == nil {
		return nil
	}
	time.Sleep(50 * time.Millisecond)
	if err := os.Rename(from, to); err != nil {
		return fmt.Errorf("replace %s: %w", to, err)
	}
	return nil
}
