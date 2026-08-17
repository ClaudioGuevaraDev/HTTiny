import { double, goRaw, multiline } from './quote'
import { bodyOf, seconds, snippetHeaders, type Wire } from './types'

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

  const imports = ['fmt', 'io', 'net/http', 'time']
  if (wire.hasBody) imports.push('strings')

  const lines = ['package main', '', 'import (', ...imports.sort().map(name => `\t${double(name)}`), ')', '', 'func main() {']
  if (wire.hasBody) lines.push(`\tbody := strings.NewReader(${literal})`, '')
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
