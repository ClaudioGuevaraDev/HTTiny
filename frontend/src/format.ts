export type StatusBucket = '2xx' | '3xx' | '4xx' | '5xx'

export const statusBucket = (status: number): StatusBucket => (status >= 500 ? '5xx' : status >= 400 ? '4xx' : status >= 300 ? '3xx' : '2xx')

/**
 * Formatters are module-level rather than per call: constructing an `Intl.NumberFormat`
 * is expensive, and `formatDuration` runs ten times a second while a request is in
 * flight. Passing `undefined` as the locale follows the user's own, so a German build
 * reads "1,24 s" instead of a hardcoded decimal point.
 */
const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const oneDecimal = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const twoDecimals = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** U+00A0. The value and its unit are one word — they must never break across lines. */
const NBSP = ' '

export const formatDuration = (ms: number): string => (ms < 1000 ? `${integer.format(ms)}${NBSP}ms` : `${twoDecimals.format(ms / 1000)}${NBSP}s`)

export const formatBytes = (bytes: number): string =>
  bytes < 1024
    ? `${integer.format(bytes)}${NBSP}B`
    : bytes < 1024 * 1024
      ? `${oneDecimal.format(bytes / 1024)}${NBSP}KB`
      : `${twoDecimals.format(bytes / 1024 / 1024)}${NBSP}MB`
