import type { MessageKey, Translate } from './i18n'
import type { BodyLanguage, BodyView, ResponseFormat } from './types'

/**
 * How a body is presented when nothing has been chosen for a request: indented, and
 * interpreted as whatever the body itself looks like — see `resolveLanguage`.
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
 * Does this body open the way JSON opens? A heuristic on the first token, not a
 * validation — and deliberately so. `resolveLanguage` runs on every render of the
 * viewer, which re-renders ten times a second while a *later* request is in flight, and
 * it runs outside its `useMemo`; a `JSON.parse` of several MB there is not affordable.
 * The regex is anchored and `trimStart()` is avoided for the same reason, since that
 * would copy the whole body just to look at one character.
 *
 * Being wrong is cheap and already handled: a body that opens with `{` and does not
 * parse reaches `formatBody`, which hands it back untouched, and the viewer says the
 * JSON did not parse. What this does miss is a JSON scalar — `42`, `"hola"` — served
 * under a Content-Type that does not say JSON. Nothing shows for it either way:
 * indenting a scalar is a no-op.
 */
const JSON_START = /^\s*[[{]/

/**
 * The reading of last resort, once the body itself has had nothing to say. A table
 * rather than a chain of ternaries, because the one entry that is a substitution is
 * worth being able to read at a glance.
 *
 * `binary` degrades to `text` defensively: those bodies never cross the binding and the
 * viewer renders them from metadata alone, so this branch exists only so `BodyLanguage`
 * does not have to widen.
 *
 * Everything else is Go's `classifyFormat` taken at its word, which is right *here* —
 * a body that does not look like JSON has no reason to be read as anything other than
 * what the `Content-Type` claimed.
 */
const AUTOMATIC = { json: 'json', html: 'html', xml: 'xml', text: 'text', binary: 'text' } as const satisfies Record<ResponseFormat, BodyLanguage>

/**
 * The language actually in effect, resolved down four steps: the one chosen for this
 * request, then the global default from Settings, then the shape of the body, and only
 * then the `Content-Type` reading above. The chained `??` is the whole precedence rule —
 * a choice made in the viewer outranks the preference, and the preference outranks both
 * of the guesses.
 *
 * The body is consulted before the `Content-Type` because it is the better witness of
 * the two: `classifyFormat` is a whitelist over the header alone, so an API behind a
 * proxy that says `text/html`, or one that ignores `Accept`, lands on `html` with a
 * JSON payload inside. Reading the body first is what makes those open indented.
 */
export const resolveLanguage = (view: BodyView, format: ResponseFormat, fallback: BodyLanguage | null, body: string): BodyLanguage =>
  view.language ?? fallback ?? (JSON_START.test(body) ? 'json' : AUTOMATIC[format])

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
