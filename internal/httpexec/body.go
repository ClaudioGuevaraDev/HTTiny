package httpexec

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/textproto"
	"net/url"
	"os"
	"strings"
)

// The four shapes an outgoing body can have. `kindText` covers json, text and
// urlencoded alike: all three end up as one string this process already holds, and
// nothing downstream — not applyContentType, not Wire, not a snippet generator —
// needs to tell them apart once the string exists.
const (
	kindNone   = ""
	kindText   = "text"
	kindForm   = "form"
	kindBinary = "binary"
)

// codedError carries the frontend's failure code alongside the diagnostic.
//
// buildRequest used to have exactly one way to fail, so both callers reported
// INVALID_URL and were right. A body made of files has two more, and reporting a
// missing attachment as a malformed URL would send the reader to the wrong field.
type codedError struct {
	code string
	err  error
}

func (e *codedError) Error() string { return e.err.Error() }
func (e *codedError) Unwrap() error { return e.err }

func coded(code string, format string, args ...any) error {
	return &codedError{code: code, err: fmt.Errorf(format, args...)}
}

// codeOf reads the code back off an error, defaulting to INVALID_URL — which is
// what parseTarget's plain errors are, and what every failure here used to be.
func codeOf(err error) string {
	var carrier *codedError
	if errors.As(err, &carrier) {
		return carrier.code
	}
	return codeInvalidURL
}

// resolvedPart is one part of a multipart body with everything known about it
// except its bytes: enough to write the envelope, report it to the code view and
// tell the user the file is gone, without a single read.
type resolvedPart struct {
	kind        string
	name        string
	value       string
	path        string
	filename    string
	contentType string
	size        int64
}

// bodySpec is the outgoing body resolved but not yet materialised.
//
// The split into two steps is the load-bearing part of this file. useWire re-asks
// Wire on every keystroke while the code view is open; if resolving a body read its
// files, typing one character into the URL with a 48 MiB attachment would re-read
// 48 MiB. So this step does os.Stat and nothing else, and materialise — which only
// Send calls — is the one that opens anything.
type bodySpec struct {
	kind        string
	contentType string
	// Non-empty for multipart only. Also the flag applyContentType branches on.
	boundary string
	parts    []resolvedPart
	// The whole body, for kindText.
	text string
	// The file, for kindBinary.
	file resolvedPart
	// What the body will weigh once materialised. Checked against maxUploadBytes here
	// rather than after reading, so an oversized attachment is refused without ever
	// being loaded.
	length int64
}

// resolveBody works out what will be sent, reading no file contents.
func resolveBody(req Request) (bodySpec, error) {
	switch req.BodyType {
	case "json":
		return textSpec(req.Body, "application/json"), nil
	case "text":
		return textSpec(req.Body, "text/plain; charset=utf-8"), nil
	case "urlencoded":
		values := url.Values{}
		for _, row := range req.Urlencoded {
			if key := strings.TrimSpace(row.Key); key != "" {
				values.Add(key, row.Value)
			}
		}
		if len(values) == 0 {
			return bodySpec{}, nil
		}
		return textSpec(values.Encode(), "application/x-www-form-urlencoded"), nil
	case "form":
		return formSpec(req)
	case "binary":
		return binarySpec(req)
	}
	return bodySpec{}, nil
}

func textSpec(text string, contentType string) bodySpec {
	if text == "" {
		return bodySpec{}
	}
	return bodySpec{kind: kindText, contentType: contentType, text: text, length: int64(len(text))}
}

func formSpec(req Request) (bodySpec, error) {
	parts := make([]resolvedPart, 0, len(req.Form))
	for _, part := range req.Form {
		name := strings.TrimSpace(part.Name)
		if name == "" {
			continue
		}
		if part.Kind != "file" {
			parts = append(parts, resolvedPart{kind: "text", name: name, value: part.Value, contentType: strings.TrimSpace(part.ContentType)})
			continue
		}
		if strings.TrimSpace(part.Path) == "" {
			continue
		}
		resolved, err := resolveFile(part.Path, part.ContentType)
		if err != nil {
			return bodySpec{}, err
		}
		resolved.kind = "file"
		resolved.name = name
		parts = append(parts, resolved)
	}
	if len(parts) == 0 {
		return bodySpec{}, nil
	}

	// A deterministic boundary, and the determinism is the point. multipart.Writer
	// invents a random one per instance, and Wire builds a fresh request per
	// keystroke — so the Content-Type header and the Raw HTTP view would rewrite
	// their own boundary as you typed, which is the complaint wireHeaders already
	// documents about lines that reshuffle themselves.
	sum := sha256.Sum256([]byte(req.ID))
	boundary := "----HTTiny" + hex.EncodeToString(sum[:12])

	spec := bodySpec{kind: kindForm, boundary: boundary, parts: parts}
	spec.contentType = mime.FormatMediaType("multipart/form-data", map[string]string{"boundary": boundary})
	spec.length = multipartLength(spec)
	if spec.length > maxUploadBytes {
		return bodySpec{}, coded(codeBodyTooLarge, "the form body is %d bytes, over the %d byte limit", spec.length, int64(maxUploadBytes))
	}
	return spec, nil
}

func binarySpec(req Request) (bodySpec, error) {
	if strings.TrimSpace(req.File.Path) == "" {
		return bodySpec{}, nil
	}
	file, err := resolveFile(req.File.Path, req.File.ContentType)
	if err != nil {
		return bodySpec{}, err
	}
	if file.size > maxUploadBytes {
		return bodySpec{}, coded(codeBodyTooLarge, "%s is %d bytes, over the %d byte limit", file.filename, file.size, int64(maxUploadBytes))
	}
	return bodySpec{kind: kindBinary, contentType: file.contentType, file: file, length: file.size}, nil
}

// resolveFile stats one attachment and decides what to call it and what to call its
// type. A path that cannot be stat'd is a hard failure rather than an empty part:
// silently sending a form with one field missing is the worst of the options.
func resolveFile(path string, override string) (resolvedPart, error) {
	info, err := os.Stat(path)
	if err != nil {
		return resolvedPart{}, coded(codeFileUnreadable, "%s could not be read: %w", baseName(path), err)
	}
	if info.IsDir() {
		return resolvedPart{}, coded(codeFileUnreadable, "%s is a directory", baseName(path))
	}
	return resolvedPart{
		path: path,
		// baseName, not filepath.Base: a workspace written on Windows can be opened on
		// Linux, where filepath.Base would report the whole `C:\dir\logo.png` as the
		// filename. See pick.go.
		filename:    baseName(path),
		contentType: fileContentType(path, override),
		size:        info.Size(),
	}, nil
}

// extensionOf is filepath.Ext over baseName, so a path from the other platform is
// still read correctly. See baseName in pick.go.
func extensionOf(path string) string {
	name := baseName(path)
	if index := strings.LastIndex(name, "."); index > 0 {
		return name[index:]
	}
	return ""
}

// fileContentType honours an override, then the extension, then gives up honestly.
// mime.TypeByExtension consults the OS registry on Windows and /etc/mime.types on
// Unix, so it knows more than any table this file could carry.
func fileContentType(path string, override string) string {
	if typed := strings.TrimSpace(override); typed != "" {
		return typed
	}
	if guess := mime.TypeByExtension(extensionOf(path)); guess != "" {
		return guess
	}
	return "application/octet-stream"
}

// multipartLength computes the exact size of the envelope this spec will produce,
// without producing it. It mirrors writePart below line for line — the two have to
// agree, and the only thing keeping them honest is that they sit next to each other.
func multipartLength(spec bodySpec) int64 {
	var total int64
	for _, part := range spec.parts {
		// CRLF --boundary CRLF, then the header block, then the content.
		total += int64(len(spec.boundary) + 6)
		total += int64(len(partHeader(part)))
		if part.kind == "file" {
			total += part.size
		} else {
			total += int64(len(part.value))
		}
	}
	// The first part has no leading CRLF, hence the -2; Close writes
	// CRLF --boundary-- CRLF, hence the +8.
	return total - 2 + int64(len(spec.boundary)+8)
}

// partHeader is the MIME header block for one part, serialised exactly as
// multipart.Writer.CreatePart writes it: `Name: value` CRLF each, then a blank CRLF.
func partHeader(part resolvedPart) string {
	var out strings.Builder
	for _, key := range partHeaderKeys(part) {
		out.WriteString(key)
		out.WriteString(": ")
		out.WriteString(partHeaderValue(part, key))
		out.WriteString("\r\n")
	}
	out.WriteString("\r\n")
	return out.String()
}

// The keys, in the order multipart writes them. It sorts the header map, and
// "Content-Disposition" sorts before "Content-Type", so this order is theirs.
func partHeaderKeys(part resolvedPart) []string {
	if part.contentType == "" {
		return []string{"Content-Disposition"}
	}
	return []string{"Content-Disposition", "Content-Type"}
}

func partHeaderValue(part resolvedPart, key string) string {
	if key == "Content-Type" {
		return part.contentType
	}
	if part.kind == "file" {
		return fmt.Sprintf(`form-data; name="%s"; filename="%s"`, escapeQuotes(part.name), escapeQuotes(part.filename))
	}
	return fmt.Sprintf(`form-data; name="%s"`, escapeQuotes(part.name))
}

// The escaping mime/multipart applies to a part name, reproduced because partHeader
// has to predict its output byte for byte and the helper is unexported there.
var quoteEscaper = strings.NewReplacer("\\", "\\\\", `"`, "\\\"")

func escapeQuotes(value string) string { return quoteEscaper.Replace(value) }

// materialise turns a resolved spec into the reader the request will carry. This is
// the step that touches the disk, and only Send reaches it.
//
// It returns a *bytes.Reader rather than a stream, and that is deliberate.
// http.NewRequest recognises the concrete type and fills in both ContentLength and
// GetBody; GetBody is what lets the client replay the body on a 307 or 308, and Send
// follows up to maxRedirects of them. A pipe would leave GetBody nil and turn every
// redirected upload into a silent truncation. A known ContentLength also keeps the
// request off Transfer-Encoding: chunked, which a fair number of upload endpoints
// refuse. The cost is holding the attachment in memory, which is what maxUploadBytes
// bounds.
func materialise(spec bodySpec) (*bytes.Reader, error) {
	switch spec.kind {
	case kindText:
		return bytes.NewReader([]byte(spec.text)), nil
	case kindBinary:
		data, err := readAttachment(spec.file)
		if err != nil {
			return nil, err
		}
		return bytes.NewReader(data), nil
	case kindForm:
		buf := &bytes.Buffer{}
		buf.Grow(int(spec.length))
		writer := multipart.NewWriter(buf)
		// Before any part is written, or it has no effect.
		if err := writer.SetBoundary(spec.boundary); err != nil {
			return nil, coded(codeInvalidURL, "multipart boundary: %w", err)
		}
		for _, part := range spec.parts {
			if err := writePart(writer, part); err != nil {
				return nil, err
			}
		}
		if err := writer.Close(); err != nil {
			return nil, coded(codeInvalidURL, "multipart body: %w", err)
		}
		return bytes.NewReader(buf.Bytes()), nil
	}
	return nil, nil
}

// writePart uses CreatePart rather than CreateFormField or CreateFormFile because it
// is the only one of the three that lets a per-part Content-Type be set — which is
// what an API that validates the type of an upload needs, and what neither of the
// convenience helpers can express.
func writePart(writer *multipart.Writer, part resolvedPart) error {
	header := textproto.MIMEHeader{}
	for _, key := range partHeaderKeys(part) {
		header.Set(key, partHeaderValue(part, key))
	}
	sink, err := writer.CreatePart(header)
	if err != nil {
		return coded(codeInvalidURL, "multipart part %q: %w", part.name, err)
	}
	if part.kind != "file" {
		if _, err := io.WriteString(sink, part.value); err != nil {
			return coded(codeInvalidURL, "multipart part %q: %w", part.name, err)
		}
		return nil
	}
	source, err := os.Open(part.path)
	if err != nil {
		return coded(codeFileUnreadable, "%s could not be read: %w", part.filename, err)
	}
	defer source.Close()
	// Capped at the size resolveBody measured plus one byte: a file that grew between
	// the stat and the read would otherwise write more than the Content-Length already
	// computed from it, and the server would see a stream that never ends where it
	// said it would.
	written, err := io.Copy(sink, io.LimitReader(source, part.size+1))
	if err != nil {
		return coded(codeFileUnreadable, "%s could not be read: %w", part.filename, err)
	}
	if written != part.size {
		return coded(codeFileUnreadable, "%s changed size while it was being sent", part.filename)
	}
	return nil
}

func readAttachment(file resolvedPart) ([]byte, error) {
	data, err := os.ReadFile(file.path)
	if err != nil {
		return nil, coded(codeFileUnreadable, "%s could not be read: %w", file.filename, err)
	}
	if int64(len(data)) > maxUploadBytes {
		return nil, coded(codeBodyTooLarge, "%s is %d bytes, over the %d byte limit", file.filename, len(data), int64(maxUploadBytes))
	}
	return data, nil
}
