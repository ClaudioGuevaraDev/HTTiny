// Package httpexec performs the application's outbound HTTP requests.
//
// This lives in Go rather than in the webview on purpose. A fetch() from the
// frontend is subject to CORS, cannot set the forbidden headers (User-Agent,
// Cookie, Host, Referer) that an HTTP client exists to set, and reports opaque
// responses with no body. None of those limits apply here.
package httpexec

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Failure codes shared with the frontend. Every one of these has copy in
// frontend/src/errors.ts; adding a code here without adding it there degrades to
// the generic "Request failed" fallback rather than breaking.
const (
	codeInvalidURL        = "INVALID_URL"
	codeTimeout           = "TIMEOUT"
	codeDNS               = "DNS_ERROR"
	codeConnectionRefused = "CONNECTION_REFUSED"
	codeTLS               = "TLS_ERROR"
	codeTooManyRedirects  = "TOO_MANY_REDIRECTS"
	codeNetwork           = "NETWORK_ERROR"
	codeCancelled         = "CANCELLED"
)

const (
	// How much of a response is read at all. Media has to clear a far higher bar than
	// text — a 12 MB PNG is an ordinary thing for an endpoint to return, and capping
	// it at the editor's limit would have shown two thirds of a picture.
	//
	// The cap has to apply before the format is known, because a server that sends no
	// Content-Type is classified by sniffing the bytes we already read. So everything
	// is read to this ceiling and the textual path trims itself afterwards.
	maxBodyBytes = 32 << 20 // 32 MiB
	// Text above this is truncated rather than shipped across the binding and into a
	// CodeMirror document. The response viewer reports the truncation.
	maxTextBytes = 5 << 20 // 5 MiB
	maxRedirects = 10
	// Only used when the request does not carry its own timeout.
	defaultTimeout = 30 * time.Second
	// Deliberately unversioned: AGENTS.md requires every manifest carrying the app
	// version to be kept in sync, and a User-Agent is not worth becoming a fourth
	// place to forget.
	userAgent = "HTTiny"
)

var errTooManyRedirects = errors.New("too many redirects")

// KeyValue is a header pair. The frontend's KeyValueRow carries `enabled`, `id`
// and `description` too; those are editor concerns and are resolved away before
// the request crosses the binding.
type KeyValue struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type Auth struct {
	Type     string `json:"type"` // none | bearer | basic
	Token    string `json:"token"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// Request mirrors the frontend's RequestDocument minus everything the network does
// not care about. `params` is deliberately absent: store.replaceQuery keeps the
// query string inside `url`, so sending the rows as well would double-encode them.
type Request struct {
	// Identifies the request whose bytes are being held, so a byte-backed response
	// can be found again on the asset route. It is the frontend's request id, and it
	// is only ever used as a map key — see bodystore.go.
	ID       string     `json:"id"`
	Method   string     `json:"method"`
	URL      string     `json:"url"`
	Headers  []KeyValue `json:"headers"`
	BodyType string     `json:"bodyType"` // none | json | text
	Body     string     `json:"body"`
	Auth     Auth       `json:"auth"`
	// Overrides the default timeout when positive.
	TimeoutMs int `json:"timeoutMs"`
}

type Response struct {
	Status     int        `json:"status"`
	StatusText string     `json:"statusText"`
	TimeMs     int        `json:"timeMs"`
	SizeBytes  int        `json:"sizeBytes"`
	Headers    []KeyValue `json:"headers"`
	// The payload, for textual formats only. Empty for every byte-backed format,
	// which carries BodyURL instead.
	Body string `json:"body"`
	// Where the webview can fetch a byte-backed payload. Empty for textual formats
	// and for a response with no body at all. The URL changes on every send, so an
	// <img> or <video> pointed at it always shows the current response.
	BodyURL string `json:"bodyUrl"`
	// Bare media type, lowercased, parameters stripped.
	ContentType string `json:"contentType"`
	// The charset the payload was transcoded *from*, when it was not already UTF-8.
	// Empty means no transcoding happened.
	Encoding string `json:"encoding"`
	// The Content-Encoding found on the response, whether or not it could be undone.
	// Non-empty with a readable body means it was decompressed here; non-empty with a
	// binary one means the algorithm is not supported.
	ContentEncoding string `json:"contentEncoding"`
	// Where the request ended up after redirects, which are otherwise invisible.
	FinalURL string `json:"finalUrl"`
	// What to call this body if it is saved. Read from the server's
	// Content-Disposition where there is one, else derived from the URL and the
	// format. Computed here because parsing that header correctly — including the
	// RFC 2231 encoded form — is `mime`'s job, not the viewer's.
	Filename string `json:"filename"`
	// The entries of a zip response. Empty for every other format, and for an archive
	// whose index could not be read.
	Archive   []ArchiveEntry `json:"archive"`
	Format    string         `json:"format"` // see classify.go
	Truncated bool           `json:"truncated"`
}

// Result is an explicit success/failure union rather than a Go `error` return.
//
// The frontend needs a stable machine-readable code, and marshalling a Go error
// across the binding yields a human string whose format is not part of any
// contract. Returning the code as data keeps the mapping in one place — the
// `classify` function below — instead of splitting it across a stringly-typed
// boundary.
type Result struct {
	OK        bool     `json:"ok"`
	ErrorCode string   `json:"errorCode"`
	ErrorText string   `json:"errorText"`
	Response  Response `json:"response"`
}

type HTTPService struct {
	transport http.RoundTripper
	// Byte-backed response payloads, held in memory for the asset route to serve.
	bodies *bodyStore
}

func New() *HTTPService { return &HTTPService{transport: newTransport(), bodies: newBodyStore()} }

func (s *HTTPService) ServiceName() string { return "HTTPExec" }

// A dedicated transport rather than http.DefaultTransport: connection pooling
// and TLS session state for the user's arbitrary targets should not be shared
// with anything else the process might do later.
func newTransport() http.RoundTripper {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.MaxIdleConnsPerHost = 4
	t.ForceAttemptHTTP2 = true
	return t
}

// Send performs one request and reports the outcome.
//
// ctx is the first parameter so that Wails marks the method as context-aware:
// cancelling the CancellablePromise on the JS side cancels this context, which
// aborts the connection rather than merely detaching the UI from it.
func (s *HTTPService) Send(ctx context.Context, req Request) Result {
	// Every field of the outgoing request is resolved in buildRequest, which the code
	// view reads back through Wire. Nothing about the wire format is decided here.
	httpReq, err := buildRequest(ctx, req)
	if err != nil {
		return failure(codeInvalidURL, err.Error())
	}

	client := &http.Client{
		Transport: s.transport,
		Timeout:   timeoutFor(req),
		CheckRedirect: func(_ *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return errTooManyRedirects
			}
			return nil
		},
	}

	// Timed around the response read, not just the round trip: a response is not
	// "arrived" until its body is in hand, and reporting otherwise would flatter
	// slow endpoints.
	started := time.Now()
	resp, err := client.Do(httpReq)
	if err != nil {
		code, text := classify(ctx, err)
		return failure(code, text)
	}
	defer resp.Body.Close()

	raw, truncated, err := readBody(resp.Body)
	if err != nil {
		code, text := classify(ctx, err)
		return failure(code, text)
	}
	elapsed := time.Since(started)

	// Before anything looks at the bytes: net/http negotiates and unwraps gzip on its
	// own, and strips the header when it does, so a Content-Encoding still present
	// here means the user set Accept-Encoding by hand and the payload is compressed.
	raw, contentEncoding, decoded := decompress(raw, resp.Header.Get("Content-Encoding"))

	media, charset := mediaTypeOf(resp.Header.Get("Content-Type"), raw)
	format := classifyFormat(media)

	size := len(raw)
	// Content-Length is the honest total when we stopped early; without it the byte
	// count is what we actually read, which `truncated` qualifies. It is no use once
	// we have decompressed, when it describes the compressed stream instead.
	if truncated && !decoded && resp.ContentLength > 0 {
		size = int(resp.ContentLength)
	}

	out := Response{
		Status:          resp.StatusCode,
		StatusText:      statusText(resp),
		TimeMs:          int(elapsed.Milliseconds()),
		SizeBytes:       size,
		Headers:         flattenHeaders(resp.Header),
		ContentType:     media,
		ContentEncoding: contentEncoding,
		FinalURL:        finalURL(resp, httpReq.URL),
		Truncated:       truncated,
	}

	// A textual payload that turns out not to be text at all falls through to the
	// byte-backed branch below, where the hex viewer can still show it. That is the
	// whole reason the veto and the storage decision are sequenced this way.
	if !isByteBacked(format) {
		if text := textBody(raw, charset, truncated); text.ok {
			out.Body = text.text
			out.Encoding = text.encoding
			out.Truncated = out.Truncated || text.capped
		} else {
			format = formatBinary
		}
	}

	if isByteBacked(format) {
		// Still not base64 across the binding: that would inflate a 4 MB image to
		// 5.3 MB of JSON string, hold it twice, and give up the Range requests that
		// let a video seek. The bytes stay here and the webview fetches them.
		out.BodyURL = s.bodies.put(req.ID, raw, servedContentType(format, media))
		// Read here, while the bytes are in hand, rather than over the asset route: the
		// index is metadata and belongs with the rest of it.
		if format == formatArchive {
			out.Archive = listArchive(raw, media)
		}
	} else {
		// This request answered with text this time. Whatever picture it returned
		// before is now unreachable from the UI and has no business being held.
		s.bodies.release(req.ID)
	}

	out.Format = format
	// Last, because it reads the format the veto above may have changed: a payload
	// that claimed to be JSON and turned out to be bytes should not be suggested
	// as `response.json`.
	out.Filename = filenameFor(resp.Header.Get("Content-Disposition"), out.FinalURL, format)
	return Result{OK: true, Response: out}
}

// finalURL reports where the request actually ended up. net/http points resp.Request
// at the last hop of a redirect chain, which is otherwise followed in total silence.
func finalURL(resp *http.Response, target *url.URL) string {
	if resp.Request != nil && resp.Request.URL != nil {
		return resp.Request.URL.String()
	}
	return target.String()
}

func failure(code, text string) Result {
	return Result{ErrorCode: code, ErrorText: text}
}

// applyHeaders uses Set for the first occurrence of a name and Add afterwards,
// so a user can legitimately send a repeated header without the last row
// silently winning.
func applyHeaders(req *http.Request, rows []KeyValue) {
	seen := make(map[string]bool, len(rows))
	for _, row := range rows {
		key := strings.TrimSpace(row.Key)
		if key == "" {
			continue
		}
		canonical := http.CanonicalHeaderKey(key)
		// Host is not a normal header: net/http reads it from the request field
		// and ignores the map, so honouring it means assigning it explicitly.
		if canonical == "Host" {
			req.Host = row.Value
			continue
		}
		if seen[canonical] {
			req.Header.Add(key, row.Value)
			continue
		}
		seen[canonical] = true
		req.Header.Set(key, row.Value)
	}
	// Go's default is "Go-http-client/1.1", which is both unhelpful in a server log
	// and occasionally blocked outright.
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", userAgent)
	}
}

// applyBodyDefaults supplies a Content-Type only when the user has not, so typing
// an explicit header still wins. Without this, a JSON body is sent with no content
// type at all and most servers reject it.
func applyBodyDefaults(req *http.Request, request Request) {
	if req.Body == nil || req.Header.Get("Content-Type") != "" {
		return
	}
	switch request.BodyType {
	case "json":
		req.Header.Set("Content-Type", "application/json")
	case "text":
		req.Header.Set("Content-Type", "text/plain; charset=utf-8")
	}
}

func applyAuth(req *http.Request, auth Auth) {
	switch auth.Type {
	case "bearer":
		if token := strings.TrimSpace(auth.Token); token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
	case "basic":
		if auth.Username != "" || auth.Password != "" {
			pair := auth.Username + ":" + auth.Password
			req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(pair)))
		}
	}
}

// readBody reads at most maxBodyBytes, reporting whether more was available.
// Reading one extra byte is what distinguishes "exactly at the cap" from "over
// the cap" without a second syscall.
func readBody(r io.Reader) ([]byte, bool, error) {
	raw, err := io.ReadAll(io.LimitReader(r, maxBodyBytes+1))
	if err != nil {
		return nil, false, err
	}
	if len(raw) > maxBodyBytes {
		return raw[:maxBodyBytes], true, nil
	}
	return raw, false, nil
}

func statusText(resp *http.Response) string {
	if text := http.StatusText(resp.StatusCode); text != "" {
		return text
	}
	// Non-standard codes: resp.Status is "599 Some Reason"; keep the reason.
	if _, reason, found := strings.Cut(resp.Status, " "); found {
		return reason
	}
	return resp.Status
}

// flattenHeaders emits one row per value, so a response carrying several
// Set-Cookie headers shows all of them instead of one joined line.
func flattenHeaders(header http.Header) []KeyValue {
	rows := make([]KeyValue, 0, len(header))
	for name, values := range header {
		for _, value := range values {
			rows = append(rows, KeyValue{Key: name, Value: value})
		}
	}
	return rows
}

// classify maps a transport failure onto the frontend's error codes.
//
// Order is load-bearing: a DNS failure is also a *url.Error, and a TLS failure is
// usually also a *net.OpError, so the specific checks have to run before the
// general ones or everything collapses into one code.
func classify(ctx context.Context, err error) (string, string) {
	if errors.Is(err, context.Canceled) || ctx.Err() == context.Canceled {
		return codeCancelled, "the request was cancelled"
	}
	if errors.Is(err, errTooManyRedirects) {
		return codeTooManyRedirects, fmt.Sprintf("stopped after %d redirects", maxRedirects)
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, os.ErrDeadlineExceeded) {
		return codeTimeout, detailOf(err)
	}

	// Client.Timeout and transport deadlines both surface as a net.Error whose
	// Timeout() reports true, which is the only reliable cross-platform signal.
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return codeTimeout, detailOf(err)
	}
	if isSyscallTimeout(err) {
		return codeTimeout, detailOf(err)
	}

	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		// The DNS_ERROR copy says "check it for typos", which fits a name that does
		// not resolve. A resolver that is itself unreachable is a network problem
		// and gets the copy that actually applies to it.
		if dnsErr.IsNotFound {
			return codeDNS, "no such host: " + dnsErr.Name
		}
		return codeNetwork, dnsErr.Error()
	}

	// TLS before the connection check: a failed handshake often wraps a lower-level
	// error, and the certificate problem is the more actionable of the two.
	var certErr *tls.CertificateVerificationError
	var unknownAuthority x509.UnknownAuthorityError
	var hostnameErr x509.HostnameError
	var invalidCert x509.CertificateInvalidError
	if errors.As(err, &certErr) || errors.As(err, &unknownAuthority) ||
		errors.As(err, &hostnameErr) || errors.As(err, &invalidCert) {
		return codeTLS, detailOf(err)
	}
	// Plain HTTP being served on a port addressed as https://.
	var recordErr tls.RecordHeaderError
	if errors.As(err, &recordErr) {
		return codeTLS, "the server did not speak TLS on this port"
	}

	if isConnectionRefused(err) {
		return codeConnectionRefused, detailOf(err)
	}

	return codeNetwork, detailOf(err)
}

// detailOf strips the *url.Error wrapper, whose Error() prefixes the whole URL —
// text the user is already looking at in the address field. What is left is the
// actual cause, which is the only part worth showing under the headline.
func detailOf(err error) string {
	var urlErr *url.Error
	if errors.As(err, &urlErr) && urlErr.Err != nil {
		return urlErr.Err.Error()
	}
	return err.Error()
}
