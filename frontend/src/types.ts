export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
export type TreeNode = CollectionNode | FolderNode | RequestNode

export interface CollectionNode {
  id: string
  type: 'collection'
  name: string
  expanded: boolean
  children: TreeNode[]
}
export interface FolderNode {
  id: string
  type: 'folder'
  name: string
  expanded: boolean
  children: TreeNode[]
}
/**
 * `method` used to be duplicated here from the backing document, and nothing kept
 * the two in sync — changing the method in the editor left the tree showing the old
 * one. The tree now reads it from `documents[requestId]` instead. `name` is still
 * denormalised because `renameNode` writes both sides and nothing else can change
 * it; if the editor ever grows a rename field, it has to follow `method` out.
 */
export interface RequestNode {
  id: string
  type: 'request'
  requestId: string
  name: string
}
export interface KeyValueRow {
  id: string
  enabled: boolean
  key: string
  value: string
  description: string
}
export interface RequestDocument {
  id: string
  kind: 'http'
  name: string
  method: HttpMethod
  url: string
  params: KeyValueRow[]
  headers: KeyValueRow[]
  body: { type: 'none' | 'json' | 'text'; content: string }
  /**
   * `token` and `password` are the only fields that never reach the workspace file:
   * they are written to the OS credential store and merged back in on load, so a
   * workspace can be copied, diffed or attached to a bug report without leaking a
   * credential for someone else's API.
   */
  auth: { type: 'none' | 'bearer' | 'basic'; token: string; username: string; password: string }
}
/**
 * How the response body should be labelled and rendered. Decided in Go from the
 * Content-Type — and overridden to `binary` when a payload that claims to be text
 * turns out not to be valid UTF-8 — so the viewer never has to re-sniff it.
 */
export type ResponseFormat = 'json' | 'html' | 'xml' | 'text' | 'binary'

/**
 * How the viewer is showing a response body, remembered per request.
 *
 * `language` overrides what Go decided, because a `Content-Type` is a claim and not
 * a fact — a JSON endpoint answering with an HTML error page, or a body labelled
 * `text/plain` that the automatic reading guessed wrong, both have to be correctable.
 * `binary` is not offered: those bytes never cross the binding, so there is nothing to
 * interpret.
 *
 * `null` is "nothing chosen yet", not a menu entry: the picker offers four real
 * languages and falls through to the default in Settings, which itself falls through to
 * whatever the response turned out to be. Once a request has been given one it keeps it
 * — that is the point of choosing, and it is why a per-request pick outranks the
 * preference rather than the other way round.
 *
 * `mode` is what the request editor's "Format JSON" button does, minus the writing
 * back: `pretty` re-indents, `raw` is exactly what the server sent.
 */
export type BodyLanguage = 'json' | 'html' | 'xml' | 'text'
export interface BodyView {
  mode: 'pretty' | 'raw'
  language: BodyLanguage | null
}

/**
 * `sizeBytes` is a number rather than a pre-baked `'1.2 KB'` string: formatting is
 * the view's job, and a real network executor hands back a byte count. `startedAt`
 * lets the loading state render a live elapsed counter without a second source of
 * truth, and `code` keeps the raw failure code so the UI can special-case it — and,
 * since the copy is resolved from it at render, so that switching language retranslates
 * a failure that is already on screen.
 *
 * On failure, `detail` is the executor's own diagnostic verbatim — Winsock or x509 text
 * produced in Go — or empty. It is deliberately not the curated advice: a system
 * message is not copy and is not translated. See `errors.ts`.
 *
 * On success, `body` is empty when `format` is `binary`: the bytes are deliberately
 * never shipped across the binding, so the viewer renders from the metadata alone.
 * `truncated` says the body was capped, in which case `sizeBytes` is the full size
 * reported by the server rather than the length of what is on screen.
 */
export type ResponseSnapshot =
  | { state: 'idle' }
  | { state: 'loading'; startedAt: number }
  | { state: 'error'; code: string; detail: string }
  | {
      state: 'success'
      status: number
      statusText: string
      time: number
      sizeBytes: number
      body: string
      headers: KeyValueRow[]
      contentType: string
      format: ResponseFormat
      truncated: boolean
    }

export interface RequestExecutor {
  execute(request: RequestDocument, signal: AbortSignal): Promise<Extract<ResponseSnapshot, { state: 'success' }>>
}

export type SplitOrientation = 'rows' | 'columns'

/**
 * `system` is a preference, not a theme: it is stored, but it never reaches CSS —
 * `theme.ts` resolves it against `prefers-color-scheme` first. Default, because an
 * app that ignores the OS setting is making a decision it was not asked to make.
 */
export type ThemePreference = 'system' | 'light' | 'dark'

/**
 * The locales with a catalogue. There is no `system` member on purpose: unlike a theme,
 * which the OS publishes and can change under a running window, the interface language
 * is a deliberate choice, and the app opens in English until one is made.
 *
 * `i18n/index.ts` types its catalogue map as `Record<Locale, Catalog>`, so adding a
 * member here is a compile error until the catalogue for it exists.
 */
export type Locale = 'en' | 'es'

export type MethodToken = Lowercase<HttpMethod>
export const methodToken = (method: HttpMethod): MethodToken => method.toLowerCase() as MethodToken

/**
 * Labels for the filled chips — the sidebar tree, the tab strip and the command palette.
 * The method picker does not use these: it is choosing a method and names it in full.
 *
 * Only OPTIONS is shortened. At seven characters it is the one method wide enough to be
 * worth it, and "OPTS" is not another word. DELETE used to be "DEL" in the tab strip,
 * which made a tab and its own tree row disagree about what the request was; it spells
 * itself out now and drops to 10px where the column is tight (see
 * `.method-chip-chip.method-delete`).
 */
export const methodLabel: Record<HttpMethod, string> = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
  HEAD: 'HEAD',
  OPTIONS: 'OPTS',
}
