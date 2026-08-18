package httpexec

import (
	"context"
	"io"
	"net/http"
	"strings"
	"time"
)

// buildRequest turns the frontend's Request into the *http.Request that will be sent.
//
// It exists because two callers need the same answer and must not derive it twice:
// Send performs it, and Wire reads its fields back to report and generate code from
// them. A second resolver in TypeScript would drift the day the header precedence or
// the URL encoding changed — the same failure mode CLAUDE.md flags for TEXT_FORMATS
// against byteBacked — so there is exactly one, and it is this.
//
// `materialised` is what keeps that sharing affordable now that a body can be made of
// files. Wire passes false and gets a request with every header resolved — the
// multipart Content-Type, boundary and all — but no body attached, because it is
// re-asked on every keystroke and reading a 48 MiB attachment per character typed is
// not a thing to do. Send passes true. Both go through resolveBody, so there is still
// one answer to "what is being sent"; only the reading of it is optional.
func buildRequest(ctx context.Context, req Request, materialised bool) (*http.Request, error) {
	target, err := parseTarget(req.URL)
	if err != nil {
		return nil, err
	}

	spec, err := resolveBody(req)
	if err != nil {
		return nil, err
	}

	var body io.Reader
	if materialised && spec.kind != kindNone {
		// A concrete *bytes.Reader, which is what lets net/http fill in ContentLength
		// and GetBody. See materialise for why both matter.
		reader, err := materialise(spec)
		if err != nil {
			return nil, err
		}
		body = reader
	}

	httpReq, err := http.NewRequestWithContext(ctx, methodOf(req), target.String(), body)
	if err != nil {
		return nil, err
	}
	applyHeaders(httpReq, req.Headers)
	applyContentType(httpReq, spec)
	// Last, so the Auth panel wins over a hand-typed Authorization header. That is
	// the precedence Postman and Insomnia use, and the panel is the more visible of
	// the two controls — silently ignoring it would be the worse surprise.
	applyAuth(httpReq, req.Auth)
	return httpReq, nil
}

func methodOf(req Request) string {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method == "" {
		return http.MethodGet
	}
	return method
}

// timeoutFor resolves the request's own timeout against the default. Shared with the
// Wire report, so the number the code view prints is the number the client uses.
func timeoutFor(req Request) time.Duration {
	if req.TimeoutMs > 0 {
		return time.Duration(req.TimeoutMs) * time.Millisecond
	}
	return defaultTimeout
}
