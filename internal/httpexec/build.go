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
func buildRequest(ctx context.Context, req Request) (*http.Request, error) {
	target, err := parseTarget(req.URL)
	if err != nil {
		return nil, err
	}

	var body io.Reader
	if hasBody(req) {
		// strings.NewReader lets net/http compute ContentLength, which avoids
		// chunked transfer encoding for a body we already hold entirely in memory.
		body = strings.NewReader(req.Body)
	}

	httpReq, err := http.NewRequestWithContext(ctx, methodOf(req), target.String(), body)
	if err != nil {
		return nil, err
	}
	applyHeaders(httpReq, req.Headers)
	applyBodyDefaults(httpReq, req)
	// Last, so the Auth panel wins over a hand-typed Authorization header. That is
	// the precedence Postman and Insomnia use, and the panel is the more visible of
	// the two controls — silently ignoring it would be the worse surprise.
	applyAuth(httpReq, req.Auth)
	return httpReq, nil
}

// hasBody reports whether this request carries a payload. Both the reader above and
// Wire's report have to agree about that, and "body type is set and the text is not
// empty" is a rule worth stating once.
func hasBody(req Request) bool {
	return req.BodyType != "" && req.BodyType != "none" && req.Body != ""
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
