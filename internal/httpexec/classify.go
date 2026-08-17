package httpexec

import (
	"bytes"
	"compress/flate"
	"compress/gzip"
	"compress/zlib"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/ianaindex"
	"golang.org/x/text/transform"
)

// Render formats the viewer knows how to present, so it never has to re-parse the
// Content-Type. Two families, and which one a format belongs to decides everything
// downstream:
//
//   - Textual formats ship their payload as Response.Body, a string, and are read
//     by an editor. isByteBacked reports false for them.
//   - Byte-backed formats ship nothing in Body. Their bytes stay in the process and
//     the webview fetches them from the asset route, which is what lets an <img>,
//     a <video> or an <embed> render them at all. isByteBacked reports true.
//
// svg is textual on purpose even though it renders as a picture: it *is* XML, the
// viewer offers its source beside the render, and keeping it out of the byte route
// keeps a scriptable document from ever being served from the app's own origin.
// See bodystore.go.
const (
	formatJSON       = "json"
	formatNDJSON     = "ndjson"
	formatXML        = "xml"
	formatHTML       = "html"
	formatSVG        = "svg"
	formatCSV        = "csv"
	formatMarkdown   = "markdown"
	formatYAML       = "yaml"
	formatJavaScript = "javascript"
	formatCSS        = "css"
	formatSSE        = "sse"
	formatText       = "text"

	formatImage   = "image"
	formatAudio   = "audio"
	formatVideo   = "video"
	formatPDF     = "pdf"
	formatFont    = "font"
	formatArchive = "archive"
	formatBinary  = "binary"
)

// byteBacked is the single source of truth for the split above. A map rather than a
// switch so bodystore.go can consult it without duplicating the list — the two
// disagreeing is exactly the bug that would serve an HTML page from our own origin.
var byteBacked = map[string]bool{
	formatImage:   true,
	formatAudio:   true,
	formatVideo:   true,
	formatPDF:     true,
	formatFont:    true,
	formatArchive: true,
	formatBinary:  true,
}

func isByteBacked(format string) bool { return byteBacked[format] }

// mediaTypeOf returns the bare, lowercased media type and the charset parameter the
// server declared, if any.
//
// The charset used to be parsed and thrown away, which is why a perfectly ordinary
// `text/html; charset=ISO-8859-1` page with accented characters failed the UTF-8 veto
// and was reported as binary. decodeText below is what now does something with it.
//
// When the server sends no Content-Type at all this sniffs the payload rather than
// guessing — http.DetectContentType only inspects the first 512 bytes, per its
// contract, which is enough to tell text from an image. A Content-Type that is
// present but *wrong* is still taken at its word; second-guessing the server is the
// user's job, through the viewer's own "interpret as" picker.
func mediaTypeOf(header string, body []byte) (media string, charset string) {
	if strings.TrimSpace(header) == "" {
		header = http.DetectContentType(body)
	}
	if parsed, params, err := mime.ParseMediaType(header); err == nil {
		return strings.ToLower(parsed), strings.ToLower(strings.TrimSpace(params["charset"]))
	}
	base, _, _ := strings.Cut(header, ";")
	return strings.ToLower(strings.TrimSpace(base)), ""
}

// classifyFormat maps a media type onto a render format. It is still a whitelist:
// anything unrecognised is binary, which now means "show the bytes in the hex
// viewer" rather than "show nothing", so erring that way costs the user much less
// than it used to.
//
// Order matters in several places. The `image/` prefix has to run after the svg case
// or SVG lands in the byte-backed family; xhtml has to run before the generic `+xml`
// suffix; and every `text/*` fallthrough has to run last, since text/csv,
// text/markdown, text/yaml, text/css and text/event-stream all match that prefix too.
func classifyFormat(media string) string {
	switch {
	// ── Byte-backed families, keyed off the top-level type ────────────────────
	case media == "image/svg+xml":
		return formatSVG
	case strings.HasPrefix(media, "image/"):
		return formatImage
	case strings.HasPrefix(media, "audio/"), media == "application/ogg":
		return formatAudio
	case strings.HasPrefix(media, "video/"), media == "application/mp4":
		return formatVideo
	case media == "application/pdf", media == "application/x-pdf":
		return formatPDF
	case strings.HasPrefix(media, "font/"),
		media == "application/font-woff", media == "application/font-woff2",
		media == "application/x-font-ttf", media == "application/x-font-otf",
		media == "application/vnd.ms-fontobject":
		return formatFont
	case media == "application/zip", media == "application/x-zip-compressed",
		media == "application/gzip", media == "application/x-gzip",
		media == "application/x-tar", media == "application/x-bzip2",
		media == "application/java-archive":
		return formatArchive

	// ── Textual families ──────────────────────────────────────────────────────
	case media == "application/x-ndjson", media == "application/ndjson",
		media == "application/jsonl", media == "application/x-jsonlines":
		return formatNDJSON
	case media == "application/json", strings.HasSuffix(media, "+json"):
		return formatJSON
	case media == "text/html", media == "application/xhtml+xml":
		return formatHTML
	case media == "application/xml", media == "text/xml", strings.HasSuffix(media, "+xml"):
		return formatXML
	case media == "text/csv", media == "text/tab-separated-values",
		media == "application/csv", media == "text/x-csv":
		return formatCSV
	case media == "text/markdown", media == "text/x-markdown":
		return formatMarkdown
	case media == "application/yaml", media == "text/yaml",
		media == "application/x-yaml", media == "text/x-yaml":
		return formatYAML
	case media == "application/javascript", media == "text/javascript",
		media == "application/x-javascript", media == "application/ecmascript":
		return formatJavaScript
	case media == "text/css":
		return formatCSS
	case media == "text/event-stream":
		return formatSSE
	case strings.HasPrefix(media, "text/"),
		media == "application/x-www-form-urlencoded", media == "application/graphql",
		media == "application/toml", media == "application/x-sh",
		media == "application/sql", media == "application/x-ini":
		return formatText

	default:
		return formatBinary
	}
}

// servedContentType is the media type written on the asset route's response, and it
// is deliberately *not* the one the remote server sent.
//
// That route serves someone else's bytes from the application's own origin, so the
// Content-Type has to come from a list we control. Echoing the server's header would
// let a hostile endpoint label its payload text/html and get a same-origin document.
// Anything not recognised here is served as an opaque download.
func servedContentType(format, media string) string {
	if !isByteBacked(format) {
		return "application/octet-stream"
	}
	switch format {
	case formatImage, formatAudio, formatVideo, formatFont:
		// The top-level type is already the guarantee we need: an image/* cannot be
		// interpreted as a document. The subtype is passed through so the webview
		// picks the right decoder, but only after the family has been verified.
		if strings.HasPrefix(media, "image/") || strings.HasPrefix(media, "audio/") ||
			strings.HasPrefix(media, "video/") || strings.HasPrefix(media, "font/") {
			return media
		}
		return "application/octet-stream"
	case formatPDF:
		return "application/pdf"
	default:
		return "application/octet-stream"
	}
}

// ── Suggested filename ───────────────────────────────────────────────────────────

// Fallback extensions, keyed by render format. Only consulted when neither the
// server nor the URL offered a name, so this is the "you asked for a JSON endpoint
// and got no filename anywhere" case rather than a general media-type table.
//
// `mime.ExtensionsByType` would answer for more types and is deliberately not used:
// it reads the system's MIME database, so the name suggested for the same response
// would differ between machines.
var formatExtension = map[string]string{
	formatJSON: ".json", formatNDJSON: ".ndjson", formatXML: ".xml", formatHTML: ".html",
	formatSVG: ".svg", formatCSV: ".csv", formatMarkdown: ".md", formatYAML: ".yaml",
	formatJavaScript: ".js", formatCSS: ".css", formatSSE: ".txt", formatText: ".txt",
	formatPDF: ".pdf", formatArchive: ".zip", formatBinary: ".bin",
}

// sanitiseFilename reduces anything a server sent to a bare name.
//
// `filename` in a Content-Disposition is attacker-controlled, and a save dialog
// pre-filled with `../../.bashrc` is a real problem rather than a theoretical one:
// the user would be confirming a path they did not read. `filepath.Base` collapses
// any directory part on the host's own separator, and the rest is belt and braces
// for the separators it does not treat as one — a Windows path arriving on Linux.
func sanitiseFilename(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	if cut := strings.LastIndexAny(name, `/\`); cut >= 0 {
		name = name[cut+1:]
	}
	name = filepath.Base(name)
	// `.` and `..` survive Base intact, and neither is a filename.
	if name == "." || name == ".." || name == string(filepath.Separator) {
		return ""
	}
	// Reserved on Windows, and nothing worth keeping on the others either.
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || strings.ContainsRune(`<>:"|?*`, r) {
			return -1
		}
		return r
	}, name)
	return strings.TrimSpace(name)
}

// filenameFor suggests what to call this body if it were saved.
//
// In order of how much the source knows: the server's own `Content-Disposition`,
// then the last segment of the URL the request actually ended at, then a generic
// name with an extension derived from the format.
//
// `mime.ParseMediaType` is what reads the header, and it is the reason this lives in
// Go rather than in the viewer: it decodes the RFC 2231 `filename*=UTF-8”…` form,
// which is how any filename outside ASCII arrives, and which a parser written by
// hand on the other side of the binding would get wrong.
func filenameFor(disposition, finalURL, format string) string {
	if disposition != "" {
		if _, params, err := mime.ParseMediaType(disposition); err == nil {
			// ParseMediaType folds `filename*` into `filename`, already decoded.
			if name := sanitiseFilename(params["filename"]); name != "" {
				return name
			}
		}
	}

	if parsed, err := url.Parse(finalURL); err == nil {
		// The *escaped* path would leave `%20` in the name; Path is already decoded.
		if name := sanitiseFilename(path.Base(parsed.Path)); name != "" && name != "/" {
			// A path segment with no extension is usually a resource id rather than a
			// file — `/v1/users/42`. Giving it the format's suffix beats saving `42`.
			if filepath.Ext(name) == "" {
				return name + formatExtension[format]
			}
			return name
		}
	}

	ext, known := formatExtension[format]
	if !known {
		ext = ".bin"
	}
	return "response" + ext
}

// ── Text decoding ────────────────────────────────────────────────────────────────

var boms = []struct {
	prefix []byte
	name   string
}{
	{[]byte{0xEF, 0xBB, 0xBF}, "utf-8"},
	{[]byte{0xFF, 0xFE, 0x00, 0x00}, "utf-32le"},
	{[]byte{0x00, 0x00, 0xFE, 0xFF}, "utf-32be"},
	{[]byte{0xFF, 0xFE}, "utf-16le"},
	{[]byte{0xFE, 0xFF}, "utf-16be"},
}

// stripBOM removes a byte-order mark and reports the encoding it announced. A BOM
// left in place shows up as a stray U+FEFF at the head of the body, and — worse —
// makes JSON.parse fail on an otherwise valid document.
//
// The UTF-32 marks are checked before the UTF-16 ones because the little-endian
// UTF-32 BOM begins with the whole UTF-16 one.
func stripBOM(raw []byte) ([]byte, string) {
	for _, bom := range boms {
		if bytes.HasPrefix(raw, bom.prefix) {
			return raw[len(bom.prefix):], bom.name
		}
	}
	return raw, ""
}

// trimPartialRune drops a multi-byte character that truncation cut in half.
//
// This fixes a real bug, not a hypothetical one. readBody slices at a fixed byte
// offset, so a 5 MiB cap lands mid-rune roughly one time in three on any body with
// non-ASCII text. utf8.Valid then failed, isTextual vetoed the format, and a large
// but perfectly valid JSON response was reported as binary with an empty body — the
// truncation itself caused the downgrade.
//
// At most three bytes are ever removed: a UTF-8 sequence is four bytes at the very
// most, so a prefix longer than that cannot be incomplete.
func trimPartialRune(raw []byte) []byte {
	for i := 0; i < utf8.UTFMax && i < len(raw); i++ {
		end := len(raw) - i
		if r, size := utf8.DecodeLastRune(raw[:end]); r != utf8.RuneError || size > 1 {
			return raw[:end]
		}
	}
	return raw
}

// isTextual is the veto over classifyFormat: a payload that *claims* to be text but
// is not valid UTF-8, or contains a NUL, would reach the viewer as a wall of
// replacement characters. A NUL byte cannot occur in text worth displaying, and
// letting invalid UTF-8 through would have Go's string conversion silently
// substitute U+FFFD for every bad byte.
//
// It runs *after* decodeText now, so a legitimately non-UTF-8 charset is transcoded
// rather than vetoed. What still fails here is a body that lied about being text.
func isTextual(body []byte) bool {
	if !utf8.Valid(body) {
		return false
	}
	return !bytes.ContainsRune(body, 0)
}

// utf8Aliases are the charset names that mean "already UTF-8". Transcoding those is
// not merely wasted work: unicode.UTF8's transformer replaces malformed sequences
// with U+FFFD, which would hide exactly the corruption isTextual exists to catch.
var utf8Aliases = map[string]bool{"": true, "utf-8": true, "utf8": true, "us-ascii": true, "ascii": true}

// decodeText transcodes a body into UTF-8 and reports the encoding it came from.
//
// The reported name is the charset the server declared, echoed back so the viewer can
// say what it did. An empty name means the bytes were already UTF-8 and nothing was
// transcoded — that is the overwhelmingly common case and it costs one map lookup.
//
// A charset nobody recognises is not an error: the bytes are handed back untouched
// and left to the isTextual veto, which is the same outcome as before this existed.
func decodeText(raw []byte, charset string) ([]byte, string) {
	if utf8Aliases[charset] {
		return raw, ""
	}
	enc, err := ianaindex.MIME.Encoding(charset)
	if err != nil || enc == nil || enc == encoding.Nop {
		return raw, ""
	}
	decoded, _, err := transform.Bytes(enc.NewDecoder(), raw)
	if err != nil {
		return raw, ""
	}
	return decoded, charset
}

// textResult is what a textual payload turned into, or that it did not.
//
// `ok` false means the body claimed to be text and is not, and the caller reclassifies
// it as binary so the hex viewer can show it. `capped` means the editor's ceiling was
// hit here rather than at the network cap, which the caller folds into Truncated.
type textResult struct {
	text     string
	encoding string
	capped   bool
	ok       bool
}

// textBody prepares a textual payload for the editor: BOM removed, transcoded to
// UTF-8, trimmed to a rune boundary, and capped at what an editor can hold.
//
// The order is the whole point. The BOM has to go first, since it announces an
// encoding and would otherwise be transcoded as content. Truncation repair has to
// follow decoding, because it is UTF-8 boundaries that matter by then. And the veto
// runs last, on exactly the bytes that would reach the screen.
func textBody(raw []byte, charset string, truncated bool) textResult {
	body, bomCharset := stripBOM(raw)
	if charset == "" {
		charset = bomCharset
	}
	body, from := decodeText(body, charset)

	if truncated {
		body = trimPartialRune(body)
	}
	capped := false
	if len(body) > maxTextBytes {
		body = trimPartialRune(body[:maxTextBytes])
		capped = true
	}

	if !isTextual(body) {
		return textResult{}
	}
	return textResult{text: string(body), encoding: from, capped: capped, ok: true}
}

// ── Content-Encoding ─────────────────────────────────────────────────────────────

var gzipMagic = []byte{0x1F, 0x8B}

// decompress undoes a Content-Encoding the transport left in place, and reports which
// encoding was found and whether it could be undone.
//
// net/http negotiates and unwraps gzip transparently — and strips the header when it
// does — so reaching this function with a non-empty encoding means the user set
// `Accept-Encoding` by hand. That disables the transparent path, and the compressed
// bytes then failed the UTF-8 veto and were reported as a binary body. It is
// documented in CLAUDE.md as correct-but-surprising; it is no longer either.
//
// brotli and zstd are not in the standard library and are not worth two dependencies
// here. They are reported by name and left compressed, so the viewer can say what
// happened instead of showing a hex dump with no explanation.
func decompress(raw []byte, header string) (out []byte, name string, ok bool) {
	name = strings.ToLower(strings.TrimSpace(header))
	// Servers legitimately send a list; the last entry is the outermost wrapping.
	if parts := strings.Split(name, ","); len(parts) > 1 {
		name = strings.TrimSpace(parts[len(parts)-1])
	}
	// A gzip stream with no header at all: rare, but it costs two bytes to notice and
	// the alternative is an unreadable body. Safe against a genuine `.gz` download,
	// which classifies as an archive and never reaches here.
	if name == "" || name == "identity" {
		if !bytes.HasPrefix(raw, gzipMagic) {
			return raw, "", false
		}
		name = "gzip"
	}

	switch name {
	case "gzip", "x-gzip":
		reader, err := gzip.NewReader(bytes.NewReader(raw))
		if err != nil {
			return raw, name, false
		}
		defer reader.Close()
		return readAllCapped(reader, raw, name)
	case "deflate":
		// RFC 2616 says zlib, much of the web means raw DEFLATE. Try the standard
		// reading first and fall back rather than picking a side.
		if reader, err := zlib.NewReader(bytes.NewReader(raw)); err == nil {
			defer reader.Close()
			return readAllCapped(reader, raw, name)
		}
		reader := flate.NewReader(bytes.NewReader(raw))
		defer reader.Close()
		return readAllCapped(reader, raw, name)
	default:
		return raw, name, false
	}
}

// readAllCapped bounds a decompression the same way readBody bounds a download.
// Without the cap a few kilobytes of hostile gzip expand into gigabytes of heap —
// the decompression bomb — and this process is a desktop application the user cannot
// restart from a supervisor.
func readAllCapped(r io.Reader, fallback []byte, name string) ([]byte, string, bool) {
	out, err := io.ReadAll(io.LimitReader(r, maxBodyBytes+1))
	if err != nil && len(out) == 0 {
		return fallback, name, false
	}
	return out, name, true
}
