import type { Locale } from './types'

export type StatusBucket = '2xx' | '3xx' | '4xx' | '5xx'

export const statusBucket = (status: number): StatusBucket => (status >= 500 ? '5xx' : status >= 400 ? '4xx' : status >= 300 ? '3xx' : '2xx')

type Precision = 'integer' | 'oneDecimal' | 'twoDecimals'

const OPTIONS: Record<Precision, Intl.NumberFormatOptions> = {
  integer: { maximumFractionDigits: 0 },
  oneDecimal: { minimumFractionDigits: 1, maximumFractionDigits: 1 },
  twoDecimals: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
}

const formattersFor = (locale: Locale): Record<Precision, Intl.NumberFormat> => ({
  integer: new Intl.NumberFormat(locale, OPTIONS.integer),
  oneDecimal: new Intl.NumberFormat(locale, OPTIONS.oneDecimal),
  twoDecimals: new Intl.NumberFormat(locale, OPTIONS.twoDecimals),
})

/**
 * One formatter per locale × precision, built once at module scope.
 *
 * The locale used to be `undefined`, meaning "follow the OS" — which stopped being
 * right the moment the app grew a language of its own: a Spanish interface on an
 * English Windows would read "1.24 s" beside "Tiempo". It is still precomputed,
 * because constructing an `Intl.NumberFormat` is expensive and `formatDuration` runs
 * ten times a second while a request is in flight. A table rather than a cache: the
 * key space is closed at 2 × 3, so there is no miss to handle and no module state
 * being mutated during a render.
 *
 * The locale arrives as an argument rather than being read from the store, so the
 * reactivity stays visible: the caller got it from `useLocale()`, so the caller
 * re-renders when it changes.
 */
const NUMBER: Record<Locale, Record<Precision, Intl.NumberFormat>> = { en: formattersFor('en'), es: formattersFor('es') }

/**
 * The value and its unit are one word — they must never break across lines.
 *
 * Written as an escape rather than as a literal character: it used to be a bare U+00A0
 * between the quotes, indistinguishable from a space to anyone editing the line, and
 * that is exactly how it gets silently retyped into a normal one.
 */
const NBSP = '\u00a0'

export const formatDuration = (ms: number, locale: Locale): string =>
  ms < 1000 ? `${NUMBER[locale].integer.format(ms)}${NBSP}ms` : `${NUMBER[locale].twoDecimals.format(ms / 1000)}${NBSP}s`

/**
 * Same table-not-cache reasoning as `NUMBER` above, for the two formatters that render a
 * moment rather than a quantity. Both are expensive to construct and the key space is
 * closed at one per locale, so there is no miss to handle.
 *
 * `RelativeTimeFormat` is what makes a cookie's expiry answer the question actually being
 * asked — "is this still valid, and for how long" — which an absolute date does not. The
 * absolute one is still built, because the exact instant belongs in the tooltip.
 */
const DATE: Record<Locale, Intl.DateTimeFormat> = {
  en: new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }),
  es: new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }),
}

const RELATIVE: Record<Locale, Intl.RelativeTimeFormat> = {
  en: new Intl.RelativeTimeFormat('en', { numeric: 'auto' }),
  es: new Intl.RelativeTimeFormat('es', { numeric: 'auto' }),
}

/** Epoch milliseconds, or an RFC 3339 string, as a readable absolute instant. */
export const formatDate = (at: number | string, locale: Locale): string => {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? '' : DATE[locale].format(date)
}

/**
 * Largest unit first, so the answer reads the way a person would say it: "in 2 weeks"
 * rather than "in 1209600 seconds". Ordered from the coarsest, and the first threshold
 * that fits wins.
 *
 * `numeric: 'auto'` is what turns the smallest gaps into "yesterday" and "now" instead of
 * "1 day ago" and "in 0 seconds".
 */
const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
  ['second', 1000],
]

/** `at` and `from` are epoch milliseconds; the sign decides past or future. */
export const formatRelative = (at: number, from: number, locale: Locale): string => {
  const delta = at - from
  const size = Math.abs(delta)
  for (const [unit, ms] of UNITS) {
    if (size >= ms) return RELATIVE[locale].format(Math.round(delta / ms), unit)
  }
  return RELATIVE[locale].format(0, 'second')
}

export const formatBytes = (bytes: number, locale: Locale): string =>
  bytes < 1024
    ? `${NUMBER[locale].integer.format(bytes)}${NBSP}B`
    : bytes < 1024 * 1024
      ? `${NUMBER[locale].oneDecimal.format(bytes / 1024)}${NBSP}KB`
      : `${NUMBER[locale].twoDecimals.format(bytes / 1024 / 1024)}${NBSP}MB`
