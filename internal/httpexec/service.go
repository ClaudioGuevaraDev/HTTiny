// Package httpexec performs the application's outbound HTTP requests.
//
// This lives in Go rather than in the webview on purpose. A fetch() from the
// frontend is subject to CORS, cannot set the forbidden headers (User-Agent,
// Cookie, Host, Referer) that an HTTP client exists to set, and reports opaque
// responses with no body. None of those limits apply here.
package httpexec

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
	"unicode/utf8"
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
	// Bodies above this are truncated rather than shipped across the binding and
	// into a CodeMirror document. The response viewer reports the truncation.
	maxBodyBytes = 5 << 20 // 5 MiB
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
	Method   string     `json:"method"`
	URL      string     `json:"url"`
	Headers  []KeyValue `json:"headers"`
	BodyType string     `json:"bodyType"` // none | json | text
	Body     string     `json:"body"`
	Auth     Auth       `json:"auth"`
	// Overrides the default timeout when positive.
	TimeoutMs int `json:"timeoutMs"`
}

// Body formats the viewer knows how to label and render, so it never has to
// re-parse the Content-Type. "binary" means Body is empty by design.
const (
	formatJSON   = "json"
	formatHTML   = "html"
	formatXML    = "xml"
	formatText   = "text"
	formatBinary = "binary"
)

type Response struct {
	Status     int        `json:"status"`
	StatusText string     `json:"statusText"`
	TimeMs     int        `json:"timeMs"`
	SizeBytes  int        `json:"sizeBytes"`
	Headers    []KeyValue `json:"headers"`
	// Empty when Format is "binary".
	Body string `json:"body"`
	// Bare media type, lowercased, parameters stripped.
	ContentType string `json:"contentType"`
	Format      string `json:"format"` // json | html | xml | text | binary
	Truncated   bool   `json:"truncated"`
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
}

func New() *HTTPService { return &HTTPService{transport: newTransport()} }

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
	target, err := parseTarget(req.URL)
	if err != nil {
		return failure(codeInvalidURL, err.Error())
	}

	var body io.Reader
	if req.BodyType != "" && req.BodyType != "none" && req.Body != "" {
		// strings.NewReader lets net/http compute ContentLength, which avoids
		// chunked transfer encoding for a body we already hold entirely in memory.
		body = strings.NewReader(req.Body)
	}

	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method == "" {
		method = http.MethodGet
	}

	httpReq, err := http.NewRequestWithContext(ctx, method, target.String(), body)
	if err != nil {
		return failure(codeInvalidURL, err.Error())
	}
	applyHeaders(httpReq, req.Headers)
	applyBodyDefaults(httpReq, req)
	// Last, so the Auth panel wins over a hand-typed Authorization header. That is
	// the precedence Postman and Insomnia use, and the panel is the more visible of
	// the two controls — silently ignoring it would be the worse surprise.
	applyAuth(httpReq, req.Auth)

	timeout := defaultTimeout
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}
	client := &http.Client{
		Transport: s.transport,
		Timeout:   timeout,
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

	media := mediaTypeOf(resp.Header.Get("Content-Type"), raw)
	format := classifyFormat(media)
	if format != formatBinary && !isTextual(raw) {
		format = formatBinary
	}

	size := len(raw)
	// Content-Length is the honest total when we stopped early; without it the byte
	// count is what we actually read, which `truncated` qualifies.
	if truncated && resp.ContentLength > 0 {
		size = int(resp.ContentLength)
	}

	out := Response{
		Status:      resp.StatusCode,
		StatusText:  statusText(resp),
		TimeMs:      int(elapsed.Milliseconds()),
		SizeBytes:   size,
		Headers:     flattenHeaders(resp.Header),
		ContentType: media,
		Format:      format,
		Truncated:   truncated,
	}
	// Binary payloads are deliberately not shipped, and deliberately not base64'd
	// either: a 4 MB image becomes 5.3 MB of string that CodeMirror would then try
	// to lay out. The viewer renders a dedicated state from the metadata instead.
	if format != formatBinary {
		out.Body = string(raw)
	}

	return Result{OK: true, Response: out}
}

func failure(code, text string) Result {
	return Result{ErrorCode: code, ErrorText: text}
}

// parseTarget rejects anything that is not an absolute http(s) URL with a host.
// The frontend deliberately does not use <input type="url">, so this is the only
// validation the request gets.
func parseTarget(raw string) (*url.URL, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("the URL is empty")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil, err
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, fmt.Errorf("unsupported scheme %q", parsed.Scheme)
	}
	if parsed.Host == "" {
		return nil, errors.New("the URL has no host")
	}
	return parsed, nil
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

// mediaTypeOf returns the bare, lowercased media type. When the server sends no
// Content-Type it sniffs the payload instead of guessing — http.DetectContentType
// only inspects the first 512 bytes, per its contract, which is enough to tell
// text from an image.
func mediaTypeOf(header string, body []byte) string {
	if strings.TrimSpace(header) == "" {
		header = http.DetectContentType(body)
	}
	if parsed, _, err := mime.ParseMediaType(header); err == nil {
		return strings.ToLower(parsed)
	}
	base, _, _ := strings.Cut(header, ";")
	return strings.ToLower(strings.TrimSpace(base))
}

// classifyFormat maps a media type onto a render format. It is intentionally a
// whitelist: anything unrecognised is binary, so a new media type errs towards the
// safe "do not dump this into a text editor" branch.
func classifyFormat(media string) string {
	switch {
	case media == "application/json" || strings.HasSuffix(media, "+json"),
		media == "application/x-ndjson":
		return formatJSON
	case media == "text/html" || media == "application/xhtml+xml":
		return formatHTML
	case media == "application/xml" || media == "text/xml" || strings.HasSuffix(media, "+xml"):
		return formatXML
	case strings.HasPrefix(media, "text/"),
		media == "application/javascript", media == "application/x-www-form-urlencoded",
		media == "application/graphql":
		return formatText
	default:
		return formatBinary
	}
}

// isTextual is the veto over classifyFormat: a payload that *claims* to be text but
// is not valid UTF-8, or contains a NUL, would reach the viewer as a wall of
// replacement characters. A NUL byte cannot occur in text worth displaying, and
// letting invalid UTF-8 through would have Go's string conversion silently
// substitute U+FFFD for every bad byte.
func isTextual(body []byte) bool {
	if !utf8.Valid(body) {
		return false
	}
	return !bytes.ContainsRune(body, 0)
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
