import type { MessageKey, Translate } from './i18n'
import { indentBraces, indentMarkup } from './response/indent'
import { TEXT_FORMATS } from './types'
import type { BodyLanguage, BodyMode, BodyView, ResponseFormat } from './types'

/**
 * How a body is presented when nothing has been chosen for a request: whatever suits
 * the format, interpreted as whatever the body itself looks like. Both nulls mean
 * "not chosen" rather than a value — see `resolveMode` and `resolveLanguage`.
 */
export const DEFAULT_BODY_VIEW: BodyView = { mode: null, language: null }

export const BODY_MODES = ['rich', 'pretty', 'raw'] as const

/**
 * The languages with a viewer of their own, and what that viewer is called.
 *
 * The label is per language because "Tree", "Preview", "Table" and "Events" are four
 * different promises, and a control that said "Rich" for all of them would be telling
 * the user nothing. A language absent from this table has no rich view, and the segment
 * is disabled rather than hidden — a control that comes and goes with the Content-Type
 * reads as a bug, which is the rule the pretty/raw pair already follows.
 */
const RICH_LABEL = {
  json: 'response.rich.tree',
  ndjson: 'response.rich.records',
  html: 'response.rich.preview',
  markdown: 'response.rich.preview',
  svg: 'response.rich.preview',
  csv: 'response.rich.table',
  sse: 'response.rich.events',
} as const satisfies Partial<Record<BodyLanguage, MessageKey>>

type RichLanguage = keyof typeof RICH_LABEL

export const hasRichView = (language: BodyLanguage): language is RichLanguage => language in RICH_LABEL

/** What the `rich` segment is called for this body. Falls back for the disabled state. */
export const richLabel = (t: Translate, language: BodyLanguage): string => (hasRichView(language) ? t(RICH_LABEL[language]) : t('response.rich.none'))

/**
 * The languages whose rendered form is the point, and whose source is the fallback
 * rather than the other way round.
 *
 * A page, a document and a picture are things you look at; JSON and XML are things you
 * read. So HTML opens rendered and JSON opens indented, and neither choice is imposed
 * on the other. Anything the user picks explicitly outranks this and is remembered.
 */
const RICH_BY_DEFAULT: ReadonlySet<BodyLanguage> = new Set<BodyLanguage>(['html', 'markdown', 'svg', 'csv', 'sse'])

/**
 * The mode actually in effect: the one chosen for this request, else the reading that
 * suits the format — and never `rich` for a language that has no rich view, which is
 * what keeps a mode remembered from a JSON response from blanking the panel when the
 * same request later answers with plain text.
 */
export function resolveMode(view: BodyView, language: BodyLanguage): BodyMode {
  const chosen = view.mode ?? (RICH_BY_DEFAULT.has(language) ? 'rich' : 'pretty')
  if (chosen === 'rich' && !hasRichView(language)) return 'pretty'
  return chosen
}

/**
 * The languages a body can be *read as*, which is exactly the set of formats that
 * arrive as a string. The byte-backed formats are deliberately absent: there is
 * nothing to interpret when the payload never crossed the binding.
 *
 * Derived from `TEXT_FORMATS` rather than restated, so the picker cannot fall behind
 * what Go can classify.
 */
export const BODY_LANGUAGES = TEXT_FORMATS

/**
 * Most of these are format names and stay as they are; only `text` is a word rather
 * than a token, and everywhere it appears it sits inside a control that reads as a
 * sentence ("Interpret body as …").
 *
 * Shared rather than per-surface so the viewer's picker and the Settings default cannot
 * disagree about which names are copy. `satisfies` is what makes a new entry in
 * `BODY_LANGUAGES` a compile error here until it is given a label — `null` being a
 * legitimate answer, meaning "uppercase the token".
 */
const BODY_LANGUAGE_LABEL = {
  json: null,
  ndjson: null,
  html: null,
  xml: null,
  svg: null,
  csv: null,
  markdown: 'response.language.markdown',
  yaml: null,
  javascript: 'response.language.javascript',
  css: null,
  sse: 'response.language.sse',
  text: 'response.language.text',
} as const satisfies Record<BodyLanguage, MessageKey | null>

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
 * rather than a chain of ternaries, because the entries that are substitutions are
 * worth being able to read at a glance.
 *
 * Every byte-backed format degrades to `text` defensively: those bodies never cross
 * the binding and the viewer renders them from `bodyUrl` alone, so those branches
 * exist only so `BodyLanguage` does not have to widen to formats it cannot interpret.
 *
 * Everything else is Go's `classifyFormat` taken at its word, which is right *here* —
 * a body that does not look like JSON has no reason to be read as anything other than
 * what the `Content-Type` claimed.
 */
const AUTOMATIC = {
  json: 'json',
  ndjson: 'ndjson',
  xml: 'xml',
  html: 'html',
  svg: 'svg',
  csv: 'csv',
  markdown: 'markdown',
  yaml: 'yaml',
  javascript: 'javascript',
  css: 'css',
  sse: 'sse',
  text: 'text',
  image: 'text',
  audio: 'text',
  video: 'text',
  pdf: 'text',
  font: 'text',
  archive: 'text',
  binary: 'text',
} as const satisfies Record<ResponseFormat, BodyLanguage>

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
 * The languages that can be re-indented. Everything else renders as it arrived, and
 * the pretty/raw control says so rather than pretending otherwise.
 */
const FORMATTABLE: ReadonlySet<BodyLanguage> = new Set<BodyLanguage>(['json', 'ndjson', 'xml', 'svg', 'html', 'css', 'javascript'])

export const canFormat = (language: BodyLanguage): boolean => FORMATTABLE.has(language)

/**
 * Indents each record of an NDJSON stream and leaves the line structure alone.
 *
 * The stream as a whole is not one JSON value, so `JSON.parse` over the body is
 * guaranteed to fail — which is exactly why a body of newline-delimited records used to
 * be reported as invalid JSON. A record that will not parse keeps its original line
 * rather than taking the whole stream down with it: half a log file is still readable,
 * and one malformed entry is usually the thing being looked for.
 */
function formatNdjson(body: string): { text: string; failed: boolean } {
  let failed = false
  const lines = body.split('\n').map(line => {
    if (!line.trim()) return line
    try {
      return JSON.stringify(JSON.parse(line), null, 2)
    } catch {
      failed = true
      return line
    }
  })
  return { text: lines.join('\n'), failed }
}

/**
 * `failed` means the body did not parse as what it claimed to be, and the caller decides
 * whether that is worth saying: a truncated body cannot parse by construction, and the
 * truncation notice already explains why.
 *
 * Malformed input comes back untouched rather than half-transformed — the same rule the
 * request editor's "Format JSON" follows, and the rule the markup and brace indenters
 * follow too, for the same reason: a body the viewer misread must not come out looking
 * like something the server sent.
 */
export function formatBody(body: string, language: BodyLanguage, mode: BodyMode): { text: string; failed: boolean } {
  if (mode === 'raw' || !body || !canFormat(language)) return { text: body, failed: false }
  switch (language) {
    case 'json':
      try {
        return { text: JSON.stringify(JSON.parse(body), null, 2), failed: false }
      } catch {
        return { text: body, failed: true }
      }
    case 'ndjson':
      return formatNdjson(body)
    case 'xml':
    case 'svg':
    case 'html':
      return { text: indentMarkup(body), failed: false }
    default:
      return { text: indentBraces(body), failed: false }
  }
}
