import { backtick, double, multiline } from './quote'
import { bodyOf, snippetHeaders, type Wire } from './types'

/**
 * A body worth reading as a template literal, escaped as a string when it is one line.
 *
 * The template form is only reached for a multi-line payload, which is where it pays: a
 * formatted JSON body as a single `"{\n  \"a\": 1\n}"` is technically correct and
 * unreadable.
 */
const body = (wire: Wire): string => {
  const text = bodyOf(wire)
  return multiline(text) ? backtick(text) : double(text)
}

const headerLines = (wire: Wire, pad: string): string[] => {
  const headers = snippetHeaders(wire)
  if (!headers.length) return []
  return [`${pad}headers: {`, ...headers.map(header => `${pad}  ${double(header.key)}: ${double(header.value)},`), `${pad}},`]
}

/**
 * `fetch`, as written in a Node script or a devtools console.
 *
 * `AbortSignal.timeout` carries the app's timeout, which is the one policy fetch has no
 * option for. Redirects need nothing: following them is fetch's default, and its cap is
 * not configurable — 20 in Node, and this app's ten is the stricter of the two.
 *
 * Worth knowing where this will *not* behave like the app: run from a page, it is subject
 * to CORS and silently drops `User-Agent`, `Cookie`, `Host` and `Referer` as forbidden
 * header names. That gap is the whole reason requests are performed in Go here — see the
 * package comment in `internal/httpexec`.
 */
export const fetchSnippet = (wire: Wire): string => {
  const lines = [`const response = await fetch(${double(wire.url)}, {`, `  method: ${double(wire.method)},`]
  lines.push(...headerLines(wire, '  '))
  if (wire.hasBody) lines.push(`  body: ${body(wire)},`)
  lines.push(`  signal: AbortSignal.timeout(${wire.policy.timeoutMs}),`, '})', '', 'console.log(await response.text())')
  return lines.join('\n')
}

/**
 * axios.
 *
 * `axios.request` rather than `axios.get`/`axios.post` so the method is data like every
 * other field, which is also what keeps a verb axios has no shorthand for working.
 * `maxRedirects` is spelled out because axios's default is 5 — fewer than this app's ten.
 */
export const axios = (wire: Wire): string => {
  const lines = [`const response = await axios.request({`, `  method: ${double(wire.method)},`, `  url: ${double(wire.url)},`]
  lines.push(...headerLines(wire, '  '))
  if (wire.hasBody) lines.push(`  data: ${body(wire)},`)
  lines.push(`  timeout: ${wire.policy.timeoutMs},`, `  maxRedirects: ${wire.policy.maxRedirects},`, '})', '', 'console.log(response.data)')
  return lines.join('\n')
}
