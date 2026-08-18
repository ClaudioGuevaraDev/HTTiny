package httpexec

import (
	"context"
	"net/http"
	"sort"
	"strings"
)

// Where a header came from. The code view labels each row with one of these, which is
// the answer to "I never typed that — who did?".
const (
	sourceRequest   = "request"   // a row in the headers grid
	sourceAuth      = "auth"      // built by the Auth panel
	sourceBody      = "body"      // the Content-Type a body type implies
	sourceClient    = "client"    // this application's own default, e.g. User-Agent
	sourceTransport = "transport" // added by net/http below us, e.g. Accept-Encoding
)

type WireHeader struct {
	Key   string `json:"key"`
	Value string `json:"value"`
	// One of the source constants above. Cosmetic: the header list itself is read off
	// the real *http.Request, so a mislabelled row still reports what is actually sent.
	Source string `json:"source"`
}

// WirePolicy is what a generated snippet has to opt into by hand to behave like this app
// does. Every field is read from the constants Send uses, never restated as a literal,
// and every field has a reader in frontend/src/snippets.
//
// It carried four more, printed as a caption under the snippet, and all four are gone
// with it. `http2` and `verifyTls` were literal `true`s — a field with only one possible
// value describes nothing. `maxBodyBytes` and `maxTextBytes` are real limits, but they
// are limits on the *response*, which is not what a code view is looking at; the response
// panel says so where it actually bites.
type WirePolicy struct {
	TimeoutMs    int `json:"timeoutMs"`
	MaxRedirects int `json:"maxRedirects"`
	// Whether the transport will negotiate and transparently undo gzip. False as soon
	// as the user sets Accept-Encoding by hand, which is exactly when it stops being
	// transparent — see decompress.
	Gzip bool `json:"gzip"`
}

// WirePart is one part of a multipart body, as the code view and the snippet
// generators see it.
//
// A file part reports its Path and its Size but never its bytes: the generators need
// the path — that is what a snippet opens — and nothing about a code view wants a
// megabyte of image inlined into it.
type WirePart struct {
	Kind        string `json:"kind"` // text | file
	Name        string `json:"name"`
	Value       string `json:"value"`
	Path        string `json:"path"`
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}

// WireFile is the whole body for the `binary` type, on the same terms as WirePart.
type WireFile struct {
	Path        string `json:"path"`
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}

// WireRequest is the request as it will leave this process.
type WireRequest struct {
	Method string `json:"method"`
	// Absolute, and already percent-encoded by parseTarget — so this is where a URL
	// typed with a literal space visibly becomes one with %20.
	URL string `json:"url"`
	// Path and query only, which is what goes in the request-line.
	Target string `json:"target"`
	// The Host header, whether it came from the URL or from an override row.
	Host string `json:"host"`
	// Whether Host came from a header row rather than from the URL. It is not in
	// Headers because applyHeaders diverts it to http.Request.Host — net/http reads
	// the field and ignores the map — so without this flag an override would be
	// invisible in every snippet.
	HostOverride bool         `json:"hostOverride"`
	Headers      []WireHeader `json:"headers"`
	// The body as text. Populated for json, text and urlencoded — the last one in its
	// already-encoded form, which is exactly what a generator would have to build
	// anyway, and is why urlencoded costs the fourteen generators nothing. Empty for
	// form and binary, whose payloads are not text and are described below instead.
	Body string `json:"body"`
	// Which of the three shapes below to read: "" | text | form | binary. Every
	// generator branches on this rather than on whether Body happens to be empty.
	BodyKind string `json:"bodyKind"`
	HasBody  bool   `json:"hasBody"`
	// Multipart only. Stable across calls — it is derived from the request id — which
	// is what stops the Raw HTTP view rewriting its own boundary as you type.
	Boundary string     `json:"boundary"`
	Parts    []WirePart `json:"parts"`
	File     WireFile   `json:"file"`
	Policy   WirePolicy `json:"policy"`
}

// WireResult is a success/failure union for the same reason Result is one: the frontend
// needs a stable code, and an invalid URL has to reach the code view as INVALID_URL
// rather than as a half-built snippet.
type WireResult struct {
	OK        bool        `json:"ok"`
	ErrorCode string      `json:"errorCode"`
	ErrorText string      `json:"errorText"`
	Request   WireRequest `json:"request"`
}

// Wire reports the request Send would perform, without performing it.
//
// Deliberately not context-aware — it does no I/O, so there is nothing to cancel and no
// reason to hand the frontend a CancellablePromise.
//
// The fidelity comes from *reading fields back off the built request* rather than
// deriving them a second time: this is the same object, produced by the same code, that
// a Send would hand to the transport.
func (s *HTTPService) Wire(req Request) WireResult {
	// False: this must not read the attachments. useWire re-asks on every keystroke,
	// and buildRequest resolves the body either way, so everything reported below —
	// the multipart Content-Type included — is known without opening a file.
	httpReq, err := buildRequest(context.Background(), req, false)
	if err != nil {
		return WireResult{ErrorCode: codeOf(err), ErrorText: err.Error()}
	}
	// Resolved a second time rather than threaded out of buildRequest, which returns
	// an *http.Request and nothing else. It is a handful of os.Stat calls, and the
	// alternative is a second return value that only this caller reads.
	spec, err := resolveBody(req)
	if err != nil {
		return WireResult{ErrorCode: codeOf(err), ErrorText: err.Error()}
	}

	// http.Request.Host wins over the URL when set, which is precisely how applyHeaders
	// honours a Host row — net/http reads that field and ignores the map.
	//
	// It is compared against the URL's host rather than against "": NewRequest seeds the
	// field from the URL itself, so a non-empty Host says nothing about who put it there.
	host := httpReq.Host
	if host == "" {
		host = httpReq.URL.Host
	}
	override := host != httpReq.URL.Host

	gzip := negotiatesGzip(httpReq)
	headers := wireHeaders(httpReq, req, spec)
	if gzip {
		// Not in httpReq.Header: http.Transport adds this itself, on the way out. Leaving
		// it out would make the view lie by omission — and would leave no explanation for
		// why responses arrive decompressed with contentEncoding empty.
		headers = append(headers, WireHeader{Key: "Accept-Encoding", Value: "gzip", Source: sourceTransport})
	}

	return WireResult{
		OK: true,
		Request: WireRequest{
			Method:       httpReq.Method,
			URL:          httpReq.URL.String(),
			Target:       httpReq.URL.RequestURI(),
			Host:         host,
			HostOverride: override,
			Headers:      headers,
			Body:         wireBody(spec),
			BodyKind:     spec.kind,
			HasBody:      spec.kind != kindNone,
			Boundary:     spec.boundary,
			Parts:        wireParts(spec),
			File:         wireFile(spec),
			Policy: WirePolicy{
				TimeoutMs:    int(timeoutFor(req).Milliseconds()),
				MaxRedirects: maxRedirects,
				Gzip:         gzip,
			},
		},
	}
}

// negotiatesGzip mirrors the condition in http.Transport: it asks for gzip only when the
// caller has not set Accept-Encoding itself, and never for a HEAD, which has no body to
// compress.
func negotiatesGzip(httpReq *http.Request) bool {
	return httpReq.Header.Get("Accept-Encoding") == "" && httpReq.Method != http.MethodHead
}

// wireHeaders flattens the built request's header map, one row per value so a repeated
// header shows every one, and attributes each to whatever put it there.
//
// The map has no order, so the rows are sorted by name to keep the view stable between
// two calls describing the same request — a code snippet that reshuffles its own lines
// on every keystroke reads as a bug.
func wireHeaders(httpReq *http.Request, req Request, spec bodySpec) []WireHeader {
	typed := typedHeaders(req.Headers)
	rows := make([]WireHeader, 0, len(httpReq.Header))
	for name, values := range httpReq.Header {
		for _, value := range values {
			rows = append(rows, WireHeader{Key: name, Value: value, Source: sourceOf(name, typed, req, spec)})
		}
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Key < rows[j].Key })
	return rows
}

// typedHeaders is the set of names the user actually entered, canonicalised the way
// applyHeaders canonicalises them.
func typedHeaders(rows []KeyValue) map[string]bool {
	typed := make(map[string]bool, len(rows))
	for _, row := range rows {
		if key := strings.TrimSpace(row.Key); key != "" {
			typed[http.CanonicalHeaderKey(key)] = true
		}
	}
	return typed
}

// sourceOf attributes a resolved header to its origin.
//
// Derived from the *inputs* rather than by re-running the appliers: re-deriving would be
// the second resolver this whole design exists to avoid. The label is presentation, so
// the cost of a wrong guess in some unforeseen case is a wrong caption, never a wrong
// request.
func sourceOf(name string, typed map[string]bool, req Request, spec bodySpec) string {
	switch {
	case name == "Authorization" && req.Auth.Type != "" && req.Auth.Type != "none":
		return sourceAuth
	// Before `typed`, unlike every other rule here: a multipart Content-Type is
	// rewritten by applyContentType even when the user typed one, because the
	// boundary has to match the body. Attributing it to the grid would credit a row
	// whose value is not what goes out.
	case name == "Content-Type" && spec.boundary != "":
		return sourceBody
	case typed[name]:
		return sourceRequest
	case name == "Content-Type" && spec.kind != kindNone:
		return sourceBody
	default:
		return sourceClient
	}
}

// wireBody is the payload as text, and empty for the two kinds that have none. The
// generators are told to branch on HasBody and BodyKind, never on this being empty.
func wireBody(spec bodySpec) string {
	if spec.kind == kindText {
		return spec.text
	}
	return ""
}

func wireParts(spec bodySpec) []WirePart {
	if spec.kind != kindForm {
		return nil
	}
	parts := make([]WirePart, 0, len(spec.parts))
	for _, part := range spec.parts {
		parts = append(parts, WirePart{
			Kind:        part.kind,
			Name:        part.name,
			Value:       part.value,
			Path:        part.path,
			Filename:    part.filename,
			ContentType: part.contentType,
			Size:        part.size,
		})
	}
	return parts
}

func wireFile(spec bodySpec) WireFile {
	if spec.kind != kindBinary {
		return WireFile{}
	}
	return WireFile{Path: spec.file.path, Filename: spec.file.filename, ContentType: spec.file.contentType, Size: spec.file.size}
}
