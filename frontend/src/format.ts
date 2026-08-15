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

export const formatBytes = (bytes: number, locale: Locale): string =>
  bytes < 1024
    ? `${NUMBER[locale].integer.format(bytes)}${NBSP}B`
    : bytes < 1024 * 1024
      ? `${NUMBER[locale].oneDecimal.format(bytes / 1024)}${NBSP}KB`
      : `${NUMBER[locale].twoDecimals.format(bytes / 1024 / 1024)}${NBSP}MB`
