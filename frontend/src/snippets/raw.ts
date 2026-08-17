import type { Wire } from './types'

/**
 * The request as HTTP/1.1 bytes.
 *
 * This is the target that answers "what is the app actually sending". Nothing here is
 * translated into a library's idiom: it is the request-line, the headers in the order and
 * the spelling that go out, and the body after one blank line.
 *
 * Two things it shows that nothing else does. `Host` comes first because HTTP/1.1
 * requires it and it is not part of the header map. And the header *names* appear
 * canonicalised — `api-key` typed in the grid leaves as `Api-Key` — because
 * `http.Header.Set` canonicalises and that is genuinely what is written to the socket.
 *
 * It says HTTP/1.1 while the transport also offers HTTP/2, where the same request travels
 * as compressed pseudo-headers with lowercase names and no request-line at all. Rendering
 * that would be a hex dump of an HPACK block, which nobody reads; the version actually
 * negotiated is reported in the policy line beside the code.
 */
export const raw = (wire: Wire): string => {
  const lines = [`${wire.method} ${wire.target} HTTP/1.1`, `Host: ${wire.host}`]
  // Every header, `Accept-Encoding` included: unlike a language snippet, this claims to
  // be the bytes, and the transport's own header is one of them.
  for (const header of wire.headers) lines.push(`${header.key}: ${header.value}`)
  // The blank line terminates the head whether or not a body follows it.
  return `${lines.join('\n')}\n\n${wire.hasBody ? wire.body : ''}`
}
