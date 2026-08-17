import type { WireHeader, WireRequest, WireResult } from '../../bindings/github.com/ClaudioGuevaraDev/httiny/internal/httpexec'

/**
 * The resolved request, as every generator sees it.
 *
 * Go slices cross the binding as `T[] | null`, so an empty header map arrives as null
 * rather than []. Normalising that once here — the same thing `goExecutor` does for
 * response headers — is what keeps `?? []` out of eleven generators.
 */
export type Wire = Omit<WireRequest, 'headers'> & { headers: WireHeader[] }

export const fromResult = (result: WireResult): Wire => ({ ...result.request, headers: result.request.headers ?? [] })

/**
 * The headers a *language* snippet should set explicitly.
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
export const snippetHeaders = (wire: Wire): WireHeader[] => [
  ...(wire.hostOverride ? [{ key: 'Host', value: wire.host, source: 'request' }] : []),
  ...wire.headers.filter(header => header.source !== 'transport'),
]

/** Seconds, for the libraries whose timeout is expressed in them. */
export const seconds = (wire: Wire): number => Math.round(wire.policy.timeoutMs / 1000)

/** The body, or an empty string — `hasBody` is the flag to branch on, never `body !== ''`. */
export const bodyOf = (wire: Wire): string => (wire.hasBody ? wire.body : '')
