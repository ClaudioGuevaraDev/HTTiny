import { double, goRaw, multiline } from './quote'
import { bodyOf, fileOf, isTextBody, partDisposition, partsOf, seconds, snippetHeaders, type Wire } from './types'

/**
 * Go's own `net/http` — the library this app is built on, so this target is the closest a
 * snippet gets to being the app itself.
 *
 * The imports are assembled from what the code actually uses rather than listed in full:
 * an unused import is a *compile error* in Go, so a fixed block would refuse to build the
 * moment a request had no body.
 *
 * A raw backquoted string carries a multi-line body, with `quote.goRaw` returning null —
 * and this falling back to an escaped literal — for the one body a raw string cannot
 * hold, its own delimiter.
 */
export const goHTTP = (wire: Wire): string => {
  const text = bodyOf(wire)
  const literal = (multiline(text) ? goRaw(text) : null) ?? double(text)
  const parts = partsOf(wire)
  const file = fileOf(wire)

  const imports = ['fmt', 'io', 'net/http', 'time']
  if (isTextBody(wire)) imports.push('strings')
  if (file) imports.push('os')
  if (parts.length) {
    imports.push('bytes', 'mime/multipart')
    if (parts.some(part => part.kind === 'file')) imports.push('os')
    if (parts.some(part => part.contentType)) imports.push('net/textproto')
  }

  const lines = ['package main', '', 'import (', ...[...new Set(imports)].sort().map(name => `\t${double(name)}`), ')', '', 'func main() {']
  if (isTextBody(wire)) lines.push(`\tbody := strings.NewReader(${literal})`, '')
  if (file) {
    // Handed to NewRequest as an *os.File, which net/http recognises: it stats the file
    // for ContentLength and fills in GetBody, so the body survives a redirect. The same
    // reasoning `materialise` documents on the app's side.
    lines.push(`\tbody, err := os.Open(${double(file.path)})`, '\tif err != nil {', '\t\tpanic(err)', '\t}', '\tdefer body.Close()', '')
  }
  if (parts.length) lines.push(...multipartLines(parts))

  lines.push(
    `\treq, err := http.NewRequest(${double(wire.method)}, ${double(wire.url)}, ${wire.hasBody ? 'body' : 'nil'})`,
    '\tif err != nil {',
    '\t\tpanic(err)',
    '\t}',
  )
  for (const header of snippetHeaders(wire)) {
    // Host is not a normal header here either. net/http reads it from the request field
    // and ignores the map — the same trap `applyHeaders` documents on the other side of
    // this binding, and the reason a `Header.Set("Host", …)` in a snippet would be a
    // silent no-op.
    if (header.key === 'Host') lines.push(`\treq.Host = ${double(header.value)}`)
    else lines.push(`\treq.Header.Set(${double(header.key)}, ${double(header.value)})`)
  }
  // The writer invented its own boundary, so the header has to come from it rather than
  // from the resolved one — which is exactly why `snippetHeaders` withheld the app's.
  if (parts.length) lines.push('\treq.Header.Set("Content-Type", writer.FormDataContentType())')
  lines.push(
    '',
    `\tclient := &http.Client{Timeout: ${seconds(wire)} * time.Second}`,
    '\tresp, err := client.Do(req)',
    '\tif err != nil {',
    '\t\tpanic(err)',
    '\t}',
    '\tdefer resp.Body.Close()',
    '',
    '\tout, err := io.ReadAll(resp.Body)',
    '\tif err != nil {',
    '\t\tpanic(err)',
    '\t}',
    '\tfmt.Println(string(out))',
    '}',
  )
  return lines.join('\n')
}

/**
 * The multipart body, assembled the way `internal/httpexec/body.go` assembles it.
 *
 * `CreatePart` with an explicit header rather than `CreateFormFile` wherever a part
 * carries a content type, and for the same reason the app does it: `CreateFormFile`
 * hard-codes `application/octet-stream` and offers no way to say otherwise. Where there
 * is no type to set, the shorter helpers read better and do the same thing.
 *
 * Variables are numbered rather than named after the field, because a form field name is
 * arbitrary text and a Go identifier is not.
 */
const multipartLines = (parts: ReturnType<typeof partsOf>): string[] => {
  const lines = ['\tbody := &bytes.Buffer{}', '\twriter := multipart.NewWriter(body)']
  parts.forEach((part, index) => {
    if (part.kind !== 'file') {
      if (!part.contentType) {
        lines.push(`\tif err := writer.WriteField(${double(part.name)}, ${double(part.value)}); err != nil {`, '\t\tpanic(err)', '\t}')
        return
      }
      lines.push(
        `\tfield${index}, err := writer.CreatePart(textproto.MIMEHeader{`,
        `\t\t"Content-Disposition": {${double(partDisposition(part))}},`,
        `\t\t"Content-Type":        {${double(part.contentType)}},`,
        '\t})',
        '\tif err != nil {',
        '\t\tpanic(err)',
        '\t}',
        `\tif _, err := io.WriteString(field${index}, ${double(part.value)}); err != nil {`,
        '\t\tpanic(err)',
        '\t}',
      )
      return
    }
    lines.push(
      `\tfile${index}, err := os.Open(${double(part.path)})`,
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
      `\tdefer file${index}.Close()`,
      `\tpart${index}, err := writer.CreatePart(textproto.MIMEHeader{`,
      `\t\t"Content-Disposition": {${double(partDisposition(part))}},`,
      `\t\t"Content-Type":        {${double(part.contentType)}},`,
      '\t})',
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
      `\tif _, err := io.Copy(part${index}, file${index}); err != nil {`,
      '\t\tpanic(err)',
      '\t}',
    )
  })
  return [...lines, '\tif err := writer.Close(); err != nil {', '\t\tpanic(err)', '\t}', '']
}
