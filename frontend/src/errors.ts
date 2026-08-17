import type { Translate } from './i18n'
import type { RedirectHop } from './types'

/**
 * Failure copy, kept separate from any one executor so the response panes can resolve
 * it without importing the transport. The codes themselves are produced by the Go
 * service in `internal/httpexec` — a code added there without an entry in the
 * catalogue still works, it just falls back to the generic copy.
 *
 * Resolution happens at render rather than at failure time, which is what lets a
 * switch of language retranslate a failure that is already on screen. `ResponseSnapshot`
 * keeps the code and the raw diagnostic; the prose lives here.
 */
const KNOWN = ['INVALID_URL', 'TIMEOUT', 'DNS_ERROR', 'CONNECTION_REFUSED', 'TLS_ERROR', 'TOO_MANY_REDIRECTS', 'NETWORK_ERROR', 'BACKEND_UNAVAILABLE'] as const

type KnownCode = (typeof KNOWN)[number]

const isKnown = (code: string): code is KnownCode => (KNOWN as readonly string[]).includes(code)

/** Mirrors maxRedirects in internal/httpexec — only ever used to word the copy. */
export const MAX_REDIRECTS = 10

/** Passed in as a param rather than written into the catalogue: a translator cannot mistype a command they never see. */
const DEV_COMMAND = 'wails3 task dev'

/**
 * The two codes whose Go-side `errorText` is *our own prose* ("the URL is empty",
 * "stopped after 10 redirects") rather than a system diagnostic. For those the
 * translated copy wins; for every other code the transport's own message wins, because
 * "connectex: no connection could be made" locates the problem in a way that "nothing
 * is listening on that host and port" cannot — and because the value of a diagnostic is
 * that it can be pasted into a search box verbatim.
 */
const PROSE_CODES = new Set<string>(['INVALID_URL', 'TOO_MANY_REDIRECTS'])

export function errorCopy(t: Translate, code: string, diagnostic = ''): { title: string; detail: string } {
  if (!isKnown(code)) return { title: t('error.UNKNOWN.title'), detail: diagnostic || t('error.UNKNOWN.detail') }

  const curated =
    code === 'TOO_MANY_REDIRECTS'
      ? t('error.TOO_MANY_REDIRECTS.detail', { limit: MAX_REDIRECTS })
      : code === 'BACKEND_UNAVAILABLE'
        ? t('error.BACKEND_UNAVAILABLE.detail', { command: DEV_COMMAND })
        : t(`error.${code}.detail`)

  return { title: t(`error.${code}.title`), detail: PROSE_CODES.has(code) ? curated : diagnostic || curated }
}

/**
 * Lets an executor carry a specific diagnostic alongside the code.
 *
 * The code alone drives the headline and the UI's special cases, but the curated copy
 * is necessarily generic. Throwing a bare `new Error(CODE)` is still supported for
 * callers with nothing to add.
 *
 * `redirects` rides along for the same reason `detail` does — it is evidence the failure
 * carries and the code cannot express. A type-only import, so this module still knows
 * nothing about any transport.
 */
export class RequestFailure extends Error {
  readonly code: string
  readonly detail?: string
  readonly redirects: readonly RedirectHop[]

  constructor(code: string, detail?: string, redirects: readonly RedirectHop[] = []) {
    super(code)
    this.name = 'RequestFailure'
    this.code = code
    this.detail = detail
    this.redirects = redirects
  }
}
