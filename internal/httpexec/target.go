package httpexec

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// parseTarget rejects anything that is not an absolute http(s) URL with a host,
// and normalises the query so it is legal in a request-target.
//
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
	parsed.RawQuery = encodeRawQuery(parsed.RawQuery)
	return parsed, nil
}

// encodeRawQuery percent-encodes the bytes that cannot appear in a request-target.
//
// This is not belt-and-braces: url.Parse does not validate or escape the query at
// all — it stores RawQuery byte for byte, and both URL.String() and
// URL.RequestURI() write it back unchanged. So a URL pasted with a literal space,
// which is an ordinary way to write an Odoo domain filter
// (?domain=[('state', '=', 'sale')]), goes out as
//
//	GET /path?domain=[('state', '=', 'sale')] HTTP/1.1
//
// and a proxy truncates the request-line at the first space and answers 400 before
// the application ever sees it. The same applies to any non-ASCII query, which
// otherwise leaves as raw UTF-8 bytes in the request-line. The path needs no
// equivalent: EscapedPath() already discards an invalid RawPath and re-escapes.
//
// The set is the WHATWG URL standard's special-query percent-encode set — what a
// browser applies for http(s) — so a URL that works when pasted into a browser
// works when pasted here.
func encodeRawQuery(query string) string {
	needed := 0
	for i := 0; i < len(query); i++ {
		if shouldEncodeQueryByte(query[i]) {
			needed++
		}
	}
	if needed == 0 {
		return query
	}

	var out strings.Builder
	// Every encoded byte grows by two characters ("%20" for one byte).
	out.Grow(len(query) + 2*needed)
	const hex = "0123456789ABCDEF"
	for i := 0; i < len(query); i++ {
		b := query[i]
		if !shouldEncodeQueryByte(b) {
			out.WriteByte(b)
			continue
		}
		out.WriteByte('%')
		out.WriteByte(hex[b>>4])
		out.WriteByte(hex[b&0x0F])
	}
	return out.String()
}

// shouldEncodeQueryByte reports whether b has to be percent-encoded in a query.
//
// '%' is never encoded, which is what makes this idempotent: a user who already
// typed %20 must not receive %2520, and guessing whether a lone '%' was meant
// literally or is a broken escape would be the worse of the two failures.
//
// '#' cannot reach here — url.Parse has already split the fragment off, and
// RequestURI() does not send it — so it is listed only to keep the set honest
// against the standard.
func shouldEncodeQueryByte(b byte) bool {
	if b == '%' {
		return false
	}
	// C0 controls and the space below; everything non-ASCII above.
	if b <= 0x20 || b > 0x7E {
		return true
	}
	switch b {
	case '"', '#', '<', '>', '\'':
		return true
	}
	return false
}
