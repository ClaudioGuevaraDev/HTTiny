/**
 * Failure copy, kept separate from any one executor so `requestRunner` can resolve
 * it without importing the transport. The codes themselves are produced by the Go
 * service in `internal/httpexec` — a code added there without an entry here still
 * works, it just falls back to the generic copy below.
 *
 * Each entry is [title, detail]. The detail should say what to do about it, not
 * restate the title.
 */
export const errorCopy: Record<string, [string, string]> = {
  INVALID_URL: ['Invalid URL', 'Enter a complete URL beginning with http:// or https://.'],
  TIMEOUT: ['Request timed out', 'No response arrived in time. The server may be slow or unreachable.'],
  DNS_ERROR: ['Host not found', 'That hostname could not be resolved. Check it for typos.'],
  CONNECTION_REFUSED: ['Connection refused', 'Nothing is listening on that host and port.'],
  TLS_ERROR: ['Certificate not trusted', 'The TLS certificate could not be verified. Check the host, or use http:// if this is a local server.'],
  TOO_MANY_REDIRECTS: ['Too many redirects', 'The server redirected more than 10 times. Check the URL and any auth you are sending.'],
  NETWORK_ERROR: ['Network error', 'The connection failed before a response arrived. Check the host, the port and your network.'],
  BACKEND_UNAVAILABLE: ['Desktop backend unavailable', 'Requests are sent by the HTTiny app itself. Run `wails3 task dev` — the browser dev server has no network layer.'],
}

export const UNKNOWN_ERROR: [string, string] = ['Request failed', 'Something went wrong before a response arrived.']

export const resolveError = (code: string): [string, string] => errorCopy[code] ?? UNKNOWN_ERROR

/**
 * Lets an executor carry a specific diagnostic alongside the code.
 *
 * The code alone drives the headline and the UI's special cases, but the curated
 * copy is necessarily generic — "nothing is listening on that host and port" is
 * less use than the underlying "connectex: no connection could be made". Throwing
 * a bare `new Error(CODE)` is still supported for callers with nothing to add.
 */
export class RequestFailure extends Error {
  readonly code: string
  readonly detail?: string

  constructor(code: string, detail?: string) {
    super(code)
    this.name = 'RequestFailure'
    this.code = code
    this.detail = detail
  }
}
