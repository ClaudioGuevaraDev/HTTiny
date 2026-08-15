import type { MessageKey, Translate } from './i18n'
import type { BodyLanguage, BodyView, ResponseFormat } from './types'

/**
 * How a body is presented when nothing has been chosen for a request: indented, and
 * interpreted as whatever Go said the Content-Type was.
 */
export const DEFAULT_BODY_VIEW: BodyView = { mode: 'pretty', language: null }

export const BODY_MODES = ['pretty', 'raw'] as const
export const BODY_LANGUAGES = ['json', 'html', 'xml', 'text'] as const

/**
 * Three of these are format names and stay as they are; only `text` is a word rather
 * than a token, and everywhere it appears it sits inside a control that reads as a
 * sentence ("Interpret body as …").
 *
 * Shared rather than per-surface so the viewer's picker and the Settings default cannot
 * disagree about which names are copy. `satisfies` is what makes a fifth entry in
 * `BODY_LANGUAGES` a compile error here until it is given a label — `null` being a
 * legitimate answer, meaning "uppercase the token".
 */
const BODY_LANGUAGE_LABEL = { json: null, html: null, xml: null, text: 'response.language.text' } as const satisfies Record<BodyLanguage, MessageKey | null>

/** The one way to name a language on screen, so no surface can spell it differently. */
export const bodyLanguageLabel = (t: Translate, language: BodyLanguage): string => {
  const key = BODY_LANGUAGE_LABEL[language]
  return key ? t(key) : language.toUpperCase()
}

/**
 * What "automatic" resolves to. A table rather than a chain of ternaries, because two of
 * the five entries are substitutions and both are worth being able to read at a glance.
 *
 * `binary` degrades to `text` defensively: those bodies never cross the binding and the
 * viewer renders them from metadata alone, so this branch exists only so `BodyLanguage`
 * does not have to widen.
 *
 * `text` resolving to `json` is the deliberate one. Go's `classifyFormat` returns `text`
 * for every `text/*` it could not place more precisely — and the most common thing
 * hiding behind that is JSON served as `text/plain`. Guessing JSON there costs little
 * when it is wrong: `formatBody` hands the body back untouched and the viewer says the
 * JSON did not parse. It does mean a genuine `text/csv` now opens with that notice.
 */
const AUTOMATIC = { json: 'json', html: 'html', xml: 'xml', text: 'json', binary: 'text' } as const satisfies Record<ResponseFormat, BodyLanguage>

/**
 * The language actually in effect, resolved down three steps: the one chosen for this
 * request, then the global default from Settings, then the automatic reading above. The
 * chained `??` is the whole precedence rule — a choice made in the viewer outranks the
 * preference, and the preference outranks the `Content-Type`.
 */
export const resolveLanguage = (view: BodyView, format: ResponseFormat, fallback: BodyLanguage | null): BodyLanguage =>
  view.language ?? fallback ?? AUTOMATIC[format]

/**
 * `failed` is only ever true for JSON that would not parse, and the caller decides
 * whether that is worth saying: a truncated body cannot parse by construction, and
 * the truncation notice already explains why.
 *
 * Malformed input comes back untouched rather than half-transformed — the same rule
 * the request editor's "Format JSON" follows, for the same reason.
 */
export function formatBody(body: string, language: BodyLanguage, mode: BodyView['mode']): { text: string; failed: boolean } {
  if (mode === 'raw' || language !== 'json' || !body) return { text: body, failed: false }
  try {
    return { text: JSON.stringify(JSON.parse(body), null, 2), failed: false }
  } catch {
    return { text: body, failed: true }
  }
}
