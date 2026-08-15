import type { BodyLanguage, BodyView, ResponseFormat } from './types'

/**
 * How a body is presented when nothing has been chosen for a request: indented, and
 * interpreted as whatever Go said the Content-Type was.
 */
export const DEFAULT_BODY_VIEW: BodyView = { mode: 'pretty', language: null }

export const BODY_MODES = ['pretty', 'raw'] as const
export const BODY_LANGUAGES = ['json', 'html', 'xml', 'text'] as const

/**
 * The language actually in effect: the one chosen for this request, or Go's
 * classification while none has been. `binary` cannot reach here — the viewer
 * renders those from metadata alone and never mounts an editor — so it degrades to
 * `text` rather than widening `BodyLanguage`.
 */
export const resolveLanguage = (view: BodyView, format: ResponseFormat): BodyLanguage =>
  view.language ?? (format === 'binary' ? 'text' : format)

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
