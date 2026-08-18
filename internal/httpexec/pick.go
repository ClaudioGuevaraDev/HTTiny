package httpexec

import (
	"os"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// The one way this failure can be reported, and deliberately *not* one of the codes in
// frontend/src/errors.ts. There is nowhere to show it: a dialog that will not open is
// what `pnpm run dev` in a plain browser looks like, where no request can be sent
// either, so `attachments.pickFiles` logs it and leaves the row alone — the same
// best-effort handling `copySnippet` gives a clipboard that refuses.
const codePickUnavailable = "PICK_UNAVAILABLE"

// PickRequest asks for the native file chooser.
type PickRequest struct {
	// The dialog's title. It comes from the frontend because it is translated copy and
	// the catalogue lives there; Go has no way to read it.
	Title string `json:"title"`
	// Whether several files can be chosen at once. The form grid's "add file" button
	// sets it — picking three files there should produce three rows — while replacing
	// the file on an existing row does not.
	Multiple bool `json:"multiple"`
}

// PickResult reports what happened, on the same terms as SaveResult: Cancelled is its
// own field rather than an error code, because dismissing a file dialog is the most
// ordinary thing a person can do with one and the interface must not be able to render
// it as a failure.
type PickResult struct {
	Paths     []string `json:"paths"`
	Cancelled bool     `json:"cancelled"`
	ErrorCode string   `json:"errorCode"`
	ErrorText string   `json:"errorText"`
}

// FileStat is what the editor needs to draw an attachment it did not just choose.
//
// The document stores a path and nothing else — a name and a size copied into it
// would be a second, staler answer the moment the file changed on disk — so the grid
// asks for these each time it renders a set of paths. Exists is the interesting one:
// it is what puts a missing attachment in front of the user before they send, rather
// than after.
type FileStat struct {
	Path   string `json:"path"`
	Name   string `json:"name"`
	Exists bool   `json:"exists"`
	Size   int64  `json:"size"`
}

// PickFiles opens the native file chooser and reports what was selected.
//
// The dialog is opened here rather than from the frontend for the reason SaveBody
// documents from the other direction, and one more: a webview cannot get a filesystem
// path out of an <input type="file"> at all. Without this method the whole feature is
// bytes over the binding in base64, which is what the response side already rejected.
func (s *HTTPService) PickFiles(req PickRequest) PickResult {
	// Resolved at call time, not construction time: the application does not exist
	// when a service is built. Same as SaveBody.
	app := application.Get()
	if app == nil || app.Dialog == nil {
		return PickResult{ErrorCode: codePickUnavailable, ErrorText: "no file dialog is available"}
	}

	// Title, Message and ButtonText are all set because the three platforms read
	// different ones — see the note in SaveBody's options for which honours what.
	dialog := app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title:                   req.Title,
		Message:                 req.Title,
		CanChooseFiles:          true,
		CanChooseDirectories:    false,
		AllowsMultipleSelection: req.Multiple,
		ResolvesAliases:         true,
	})

	paths, err := dialog.PromptForMultipleSelection()
	// An empty selection means cancelled, whatever `err` says. This is the same rule
	// SaveBody documents: Windows reports a dismissed dialog *as an error* while macOS
	// and Linux return nothing and no error, and keying on the result is the only rule
	// true on all three.
	kept := make([]string, 0, len(paths))
	for _, path := range paths {
		if strings.TrimSpace(path) != "" {
			kept = append(kept, path)
		}
	}
	if len(kept) == 0 {
		return PickResult{Cancelled: true, Paths: []string{}}
	}
	if err != nil {
		return PickResult{ErrorCode: codePickUnavailable, ErrorText: err.Error(), Paths: []string{}}
	}
	// Trimmed to one even when the dialog was asked for a single selection: the Wails
	// API is the same call either way, and a platform that ignored the flag would
	// otherwise silently add rows the caller did not ask for.
	if !req.Multiple {
		kept = kept[:1]
	}
	return PickResult{Paths: kept}
}

// StatFiles reports the name, size and existence of each path, in the order given.
//
// Deliberately tolerant: a path that cannot be stat'd comes back with Exists false
// rather than as an error, because that is not a failure of this call — it is the
// answer, and it is the one the grid renders in red.
func (s *HTTPService) StatFiles(paths []string) []FileStat {
	stats := make([]FileStat, 0, len(paths))
	for _, path := range paths {
		stats = append(stats, statFile(path))
	}
	return stats
}

func statFile(path string) FileStat {
	stat := FileStat{Path: path, Name: baseName(path)}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return stat
	}
	stat.Exists = true
	stat.Size = info.Size()
	return stat
}

// baseName splits on both separators rather than using filepath.Base.
//
// A workspace file is portable — that is the whole reason it is JSON with a schema the
// frontend owns — so a path written on Windows can perfectly well be read on Linux,
// where filepath.Base would treat the entire `C:\Users\me\logo.png` as one segment and
// report it verbatim as the filename. The file will not open there either, but naming
// it wrongly on top of that helps nobody read the error.
func baseName(path string) string {
	trimmed := strings.TrimRight(path, `/\`)
	if index := strings.LastIndexAny(trimmed, `/\`); index >= 0 {
		return trimmed[index+1:]
	}
	return trimmed
}
