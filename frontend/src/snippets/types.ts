import type { WireFile, WireHeader, WirePart, WireRequest, WireResult } from '../../bindings/github.com/ClaudioGuevaraDev/httiny/internal/httpexec'

/**
 * The resolved request, as every generator sees it.
 *
 * Go slices cross the binding as `T[] | null`, so an empty header map arrives as null
 * rather than []. Normalising that once here — the same thing `goExecutor` does for
 * response headers — is what keeps `?? []` out of eleven generators.
 */
export type Wire = Omit<WireRequest, 'headers' | 'parts'> & { headers: WireHeader[]; parts: WirePart[] }

export const fromResult = (result: WireResult): Wire => ({
  ...result.request,
  headers: result.request.headers ?? [],
  parts: result.request.parts ?? [],
})

export type { WireFile, WirePart }

/**
 * Every header a snippet should set explicitly, before the multipart question below.
 *
 * Two departures from the wire bytes, and both are about behaving the same rather than
 * looking the same:
 *
 * - `Accept-Encoding` is dropped. Every HTTP library negotiates compression itself and
 *   transparently undoes it; setting the header by hand is precisely what *disables*
 *   that — in Go it is what `decompress` exists to clean up after. curl gets
 *   `--compressed` instead, which is the same intent expressed the way curl expects it.
 * - `Host` is added back when it was overridden, because `applyHeaders` diverts it to
 *   `http.Request.Host` and it is therefore not in the header map at all.
 */
export const allSnippetHeaders = (wire: Wire): WireHeader[] => [
  ...(wire.hostOverride ? [{ key: 'Host', value: wire.host, source: 'request' }] : []),
  ...wire.headers.filter(header => header.source !== 'transport'),
]

/**
 * The same list minus the one header a library that builds its own multipart body must
 * never be handed: `Content-Type`.
 *
 * This is not tidying. `curl -F`, `FormData`, `requests(files=)`, `MultipartFormDataContent`
 * and every other form builder invents its **own** boundary, and setting the header
 * ourselves pins the one Go computed — so the receiving server would look for a boundary
 * that appears nowhere in the body and find no parts at all. Found the way this whole
 * directory's other four notes were: by running the output.
 *
 * The two targets that do not go through here are the two that are genuinely writing the
 * envelope themselves — `raw`, which claims to be the bytes, and `java`, whose JDK client
 * has no form builder and so assembles the body around this exact boundary.
 */
export const snippetHeaders = (wire: Wire): WireHeader[] =>
  allSnippetHeaders(wire).filter(header => !(wire.bodyKind === 'form' && header.key.toLowerCase() === 'content-type'))

/** Seconds, for the libraries whose timeout is expressed in them. */
export const seconds = (wire: Wire): number => Math.round(wire.policy.timeoutMs / 1000)

/**
 * The body as text, or an empty string.
 *
 * `hasBody` is the flag to branch on, never `body !== ''` — and now that a body can be a
 * set of files, `bodyKind` is the flag that says whether there is any text to read at
 * all. A `form` or `binary` request has a body and no `body` string, by construction.
 */
export const isTextBody = (wire: Wire): boolean => wire.bodyKind === 'text'
export const isForm = (wire: Wire): boolean => wire.bodyKind === 'form'
export const bodyOf = (wire: Wire): string => (isTextBody(wire) ? wire.body : '')

/** The parts of a multipart body, and empty for every other kind. */
export const partsOf = (wire: Wire): WirePart[] => (isForm(wire) ? wire.parts : [])

/** The attached file for a `binary` body, and null for every other kind. */
export const fileOf = (wire: Wire): WireFile | null => (wire.bodyKind === 'binary' && wire.file.path ? wire.file : null)

/**
 * The `Content-Disposition` value for one part, escaped exactly as `mime/multipart`
 * escapes it — and as `partHeaderValue` in `internal/httpexec/body.go` reproduces it.
 * Only the two targets that write the envelope by hand need this.
 */
const escapeQuotes = (value: string): string => value.split('\\').join('\\\\').split('"').join('\\"')

export const partDisposition = (part: WirePart): string =>
  part.kind === 'file'
    ? `form-data; name="${escapeQuotes(part.name)}"; filename="${escapeQuotes(part.filename)}"`
    : `form-data; name="${escapeQuotes(part.name)}"`

/**
 * What stands in for a file's bytes in a view that is showing bytes.
 *
 * Not translated, and not formatted for a locale either: it sits inside a code view
 * beside header names and a boundary, which is the company byte counts already keep.
 */
export const fileStandIn = (name: string, size: number): string => `‹contents of ${name}, ${size} bytes›`
