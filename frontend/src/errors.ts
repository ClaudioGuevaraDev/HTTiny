/**
 * Kept out of `mockExecutor.ts` so `requestRunner` can resolve failure copy without
 * importing the mock — the runner has to work identically once a real network
 * executor is swapped in.
 *
 * Each entry is [title, detail]. The detail should say what to do about it, not
 * restate the title.
 */
export const errorCopy: Record<string, [string, string]> = {
  INVALID_URL: ['Invalid URL', 'Enter a complete URL beginning with http:// or https://.'],
  TIMEOUT: ['Request timed out', 'No response arrived in time. The server may be slow or unreachable.'],
  DNS_ERROR: ['Host not found', 'That hostname could not be resolved. Check it for typos.'],
  CONNECTION_REFUSED: ['Connection refused', 'Nothing is listening on that host and port.'],
}

export const UNKNOWN_ERROR: [string, string] = ['Request failed', 'Something went wrong before a response arrived.']

export const resolveError = (code: string): [string, string] => errorCopy[code] ?? UNKNOWN_ERROR
