package httpexec

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Failure codes for saving, on the same terms as the send codes above: a stable
// token the frontend branches on, with its copy in frontend/src/errors.ts. A code
// added here without an entry there degrades to the generic message.
const (
	codeSaveUnavailable = "SAVE_UNAVAILABLE"
	codeSaveNoBody      = "SAVE_NO_BODY"
	codeSaveFailed      = "SAVE_FAILED"
)

// SaveRequest asks for a response body to be written to a file the user picks.
type SaveRequest struct {
	// The request whose body to save. Byte-backed payloads are found in the store
	// under this key; see bodystore.go.
	ID string `json:"id"`
	// The body as the viewer has it. Used only when the store holds nothing for ID —
	// a textual payload crossed the binding as a string and is deliberately not
	// retained here, so the frontend is the only place it still exists.
	Text string `json:"text"`
	// Suggested name, normally Response.Filename handed straight back. Sanitised
	// again on arrival rather than trusted: it made a round trip through the
	// frontend, and this is the side that puts it in front of a file dialog.
	Filename string `json:"filename"`
	// The dialog's title. It comes from the frontend because it is translated copy
	// and the catalogue lives there; Go has no way to read it.
	Title string `json:"title"`
}

// SaveResult reports what happened.
//
// Cancelled is its own field rather than an error code, and that is the whole point
// of the shape: dismissing a file dialog is the most ordinary thing a person can do
// with one, and the interface must not be able to render it as a failure.
type SaveResult struct {
	OK        bool `json:"ok"`
	Cancelled bool `json:"cancelled"`
	// Where it was written, so the UI can name the file it just produced.
	Path      string `json:"path"`
	ErrorCode string `json:"errorCode"`
	ErrorText string `json:"errorText"`
}

func saveFailed(code string, err error) SaveResult {
	text := ""
	if err != nil {
		text = err.Error()
	}
	return SaveResult{ErrorCode: code, ErrorText: text}
}

// SaveBody writes a response body to a file the user chooses.
//
// This exists because the byte route made the app a dead end for its own best
// output. A PDF, a PNG or a zip renders beautifully and cannot be got out: the copy
// button is disabled for a body that is not text, and the bytes live only in this
// process, under a 64 MiB ceiling that evicts them as soon as another large response
// arrives.
//
// The dialog is opened here rather than from the frontend, although the Wails
// runtime offers both. The process that opens it is already the one holding the
// bytes; going the other way would mean handing a filesystem path back across the
// binding for Go to write to, which is a wider door than this needs.
func (s *HTTPService) SaveBody(req SaveRequest) SaveResult {
	data, ok := s.bodyFor(req)
	if !ok {
		return saveFailed(codeSaveNoBody, errors.New("this response has no body to save"))
	}

	// Resolved at call time, not construction time: the application does not exist
	// when a service is built. Unlike the updater there is nothing to memoise here —
	// SaveFileWithOptions is a plain constructor — so no sync.Once, matching what
	// internal/updates does for app.Browser in OpenDownloadPage.
	app := application.Get()
	if app == nil || app.Dialog == nil {
		return saveFailed(codeSaveUnavailable, errors.New("no file dialog is available"))
	}

	name := sanitiseFilename(req.Filename)
	if name == "" {
		name = "response"
	}

	// Every field below is read by some platforms and ignored by others, so all of
	// them are set. Windows honours Title, Filters and Filename; macOS honours
	// Message and the booleans but neither Title nor Filters; Linux honours Title,
	// Filters and ButtonText but not Filename. Filling one and hoping is how this
	// ends up looking unfinished on two of the three.
	//
	// SaveFileWithOptions rather than the chained setters for a second reason: the
	// save dialog has no SetTitle at all, and Options is the only way to set one.
	dialog := app.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
		Title:                req.Title,
		Message:              req.Title,
		Filename:             name,
		Filters:              saveFilters(name),
		CanCreateDirectories: true,
	})

	path, err := dialog.PromptForSingleSelection()
	// An empty path means cancelled, whatever `err` says. Windows reports a dismissed
	// dialog *as an error* — cfd returns one and closes the channel — while macOS and
	// Linux return an empty string and no error. Keying on the path is the only rule
	// true on all three. It does fold a genuine dialog failure into "cancelled" on
	// Windows, which is the right way round to be wrong: the alternative is an error
	// message every time somebody presses Cancel.
	if strings.TrimSpace(path) == "" {
		return SaveResult{Cancelled: true}
	}
	if err != nil {
		return saveFailed(codeSaveFailed, err)
	}

	// Written directly, not through workspace's temp-and-rename. That dance protects
	// the app's own files in the app's own directory, where a stray .tmp is ours to
	// clean up; here the user picked the directory and leaving debris beside their
	// file would be the worse failure. 0o600 because a response body can carry a
	// token or someone's personal data — the same reasoning as the workspace file.
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return saveFailed(codeSaveFailed, fmt.Errorf("write %s: %w", filepath.Base(path), err))
	}
	return SaveResult{OK: true, Path: path}
}

// bodyFor picks the bytes to write.
//
// The retained bytes win when they exist, and that condition is exactly the one
// `Send` used to decide between BodyURL and Body — so what gets saved cannot drift
// from what is on screen. For a textual body the store deliberately holds nothing,
// and the text the viewer received is both the only copy and the honest answer to
// "save what I am looking at": already decoded to UTF-8, and trimmed to the editor's
// ceiling if the response was large. The viewer says so before this is called.
func (s *HTTPService) bodyFor(req SaveRequest) ([]byte, bool) {
	if held, ok := s.bodies.get(req.ID); ok && len(held.data) > 0 {
		return held.data, true
	}
	if req.Text != "" {
		return []byte(req.Text), true
	}
	return nil, false
}

// saveFilters offers the file's own kind first and "all files" second.
//
// Order matters beyond presentation: on Windows the first filter's first pattern is
// what supplies the extension appended to a name typed without one. The display name
// is built from the extension rather than translated, for the reason format badges
// are not translated either — it is a token, not prose.
func saveFilters(name string) []application.FileFilter {
	all := application.FileFilter{DisplayName: "All files (*.*)", Pattern: "*.*"}
	ext := strings.TrimPrefix(filepath.Ext(name), ".")
	if ext == "" {
		return []application.FileFilter{all}
	}
	return []application.FileFilter{
		{DisplayName: fmt.Sprintf("%s (*.%s)", strings.ToUpper(ext), ext), Pattern: "*." + ext},
		all,
	}
}
