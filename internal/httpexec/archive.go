package httpexec

import (
	"archive/zip"
	"bytes"
	"strings"
)

// Bounds what a listing can cost. A zip's central directory is attacker-controlled and
// can claim millions of entries in a few kilobytes; the viewer would then be asked to
// render a table of them. Anything past this is reported by count rather than by row.
const maxArchiveEntries = 2000

// ArchiveEntry is one file inside an archive. Sizes are the two that matter when
// looking at a response: what it takes on the wire and what it becomes.
type ArchiveEntry struct {
	Name string `json:"name"`
	// Uncompressed size in bytes.
	Size int64 `json:"size"`
	// Size within the archive. Equal to Size for a stored entry.
	CompressedSize int64 `json:"compressedSize"`
	// RFC 3339, or empty when the entry carries no usable timestamp.
	Modified  string `json:"modified"`
	Directory bool   `json:"directory"`
}

// listArchive reads a zip's central directory and returns its entries.
//
// Only zip is read. gzip and tar classify as archives too, but a gzip stream carries no
// index at all — you would have to decompress the whole thing to say what is in it —
// and tar has no directory either, only a walk. Both still get the hex viewer, which is
// what they had before this existed.
//
// Failure is not an error worth surfacing: something that is not a readable zip simply
// has no index, and the viewer falls back to the bytes.
func listArchive(raw []byte, media string) []ArchiveEntry {
	if !isZipMedia(media) || len(raw) == 0 {
		return nil
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil
	}

	entries := make([]ArchiveEntry, 0, min(len(reader.File), maxArchiveEntries))
	for _, file := range reader.File {
		if len(entries) >= maxArchiveEntries {
			break
		}
		modified := ""
		// A zip written without an extended timestamp reports the zero time, which as
		// an RFC 3339 string would render as a confident and entirely fictional 1 Jan
		// year 1. Empty is the honest answer.
		if stamp := file.Modified; !stamp.IsZero() {
			modified = stamp.UTC().Format("2006-01-02T15:04:05Z")
		}
		entries = append(entries, ArchiveEntry{
			Name:           file.Name,
			Size:           int64(file.UncompressedSize64),
			CompressedSize: int64(file.CompressedSize64),
			Modified:       modified,
			Directory:      strings.HasSuffix(file.Name, "/"),
		})
	}
	return entries
}

func isZipMedia(media string) bool {
	switch media {
	case "application/zip", "application/x-zip-compressed", "application/java-archive":
		return true
	default:
		return false
	}
}
