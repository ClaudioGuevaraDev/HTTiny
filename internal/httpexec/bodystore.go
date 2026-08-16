package httpexec

import (
	"bytes"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// bodyRoutePrefix is the one path the asset middleware claims. The leading double
// underscore keeps it out of the way of anything the frontend build could ever emit.
const bodyRoutePrefix = "/__httiny/body/"

// retainedBytes bounds what the whole store holds at once. Response bodies are not
// small, this is a desktop process nobody restarts, and a user working through a
// collection of media endpoints would otherwise accumulate every one of them.
const retainedBytes = 64 << 20 // 64 MiB

// storedBody is one response's bytes, held in memory only. Nothing here is ever
// written to disk: these are somebody else's payloads, and the workspace file is
// documented as safe to copy or attach to a bug report.
type storedBody struct {
	data []byte
	// Written on the response, not read from the remote header. See servedContentType.
	contentType string
	version     uint64
}

// bodyStore keeps the most recent response body per request id so the webview can
// fetch it as an ordinary URL.
//
// This is what makes an image render at all. The bytes deliberately do not cross the
// Wails binding — base64 would inflate a 4 MB image to 5.3 MB of JSON string, hold it
// twice in memory, and give up Range requests, which are what let a <video> seek and
// an embedded PDF page. Serving them over the asset server costs one map and gives
// http.ServeContent's Range and conditional handling for free.
type bodyStore struct {
	mu      sync.Mutex
	items   map[string]*storedBody
	order   []string // least-recently-stored first
	total   int
	version uint64
}

func newBodyStore() *bodyStore {
	return &bodyStore{items: make(map[string]*storedBody)}
}

// put replaces whatever was held for id and returns the URL the viewer should use.
//
// The version travels in the query string rather than in an ETag alone, so re-sending
// a request changes the URL. An <img> pointed at an unchanged src does not re-fetch,
// however carefully the response is labelled — the picture would simply not update.
func (s *bodyStore) put(id string, data []byte, contentType string) string {
	if id == "" || len(data) == 0 {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	s.evictLocked(id)
	s.version++
	s.items[id] = &storedBody{data: data, contentType: contentType, version: s.version}
	s.order = append(s.order, id)
	s.total += len(data)

	// Trim to the ceiling *after* inserting, so the body just stored survives even if
	// it is on its own larger than the budget. Dropping the thing the user is about to
	// look at, to stay under a limit, would be the wrong trade.
	for s.total > retainedBytes && len(s.order) > 1 {
		s.evictLocked(s.order[0])
	}

	return fmt.Sprintf("%s%s?v=%d", bodyRoutePrefix, url.PathEscape(id), s.version)
}

// release drops one entry. Called when a tab closes or a response is cleared: the
// LRU ceiling is a backstop, not a substitute for letting go of what is plainly dead.
func (s *bodyStore) release(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.evictLocked(id)
}

func (s *bodyStore) evictLocked(id string) {
	item, ok := s.items[id]
	if !ok {
		return
	}
	s.total -= len(item.data)
	delete(s.items, id)
	for i, held := range s.order {
		if held == id {
			s.order = append(s.order[:i], s.order[i+1:]...)
			break
		}
	}
}

func (s *bodyStore) get(id string) (*storedBody, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[id]
	return item, ok
}

// serve answers a request on bodyRoutePrefix.
//
// Every header written here is a deliberate restriction, because this route hands the
// webview bytes that came from somebody else's server, from the application's own
// origin. Getting it wrong is not a rendering bug, it is a same-origin script
// execution:
//
//   - The Content-Type was chosen by servedContentType from our own allowlist. The
//     remote header is never echoed, and no textual format is ever stored, so this
//     route cannot emit text/html.
//   - nosniff stops the webview from disagreeing with that Content-Type.
//   - The CSP denies every subresource and sandboxes the response into an opaque
//     origin, so even a payload that talked its way past the two rules above has
//     nothing to reach.
//   - inline disposition, since the point is to display it.
//
// The id is a map key, not a path: there is no filesystem behind this and therefore
// no traversal to defend against.
func (s *bodyStore) serve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id, err := url.PathUnescape(strings.TrimPrefix(r.URL.Path, bodyRoutePrefix))
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	item, ok := s.get(id)
	if !ok {
		http.Error(w, "no body held for this request", http.StatusNotFound)
		return
	}

	header := w.Header()
	header.Set("Content-Type", item.contentType)
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	header.Set("Content-Disposition", "inline")
	header.Set("Etag", strconv.FormatUint(item.version, 10))
	// The version is part of the URL, so a cached copy can only ever be the right one.
	header.Set("Cache-Control", "private, max-age=3600")

	// A zero modtime tells ServeContent to skip Last-Modified and rely on the ETag,
	// which is the only freshness signal that means anything here. Range handling,
	// If-None-Match and the 206 come from ServeContent itself.
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(item.data))
}

// BodyRoute is the asset-server middleware. It claims bodyRoutePrefix and delegates
// everything else, so the frontend — bundled or served by Vite under
// `wails3 task dev` — is unaffected.
//
// The directive keeps it out of the generated bindings. It is a method on the service
// only because it needs the store; it is called by main.go, never by the frontend, and
// without this the generator emits a binding whose parameter is an http.Handler — a
// non-empty interface it warns cannot survive encoding/json.
//
//wails:ignore
func (s *HTTPService) BodyRoute(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, bodyRoutePrefix) {
			s.bodies.serve(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Release lets the frontend drop a retained body when its tab closes or its response
// is cleared. Nothing breaks if it is never called — the store has its own ceiling —
// but a user who has just closed a tab has no reason to still be holding 30 MB of it.
func (s *HTTPService) Release(id string) {
	s.bodies.release(id)
}
