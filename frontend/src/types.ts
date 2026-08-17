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
 *
 * The split matters more than the individual members. `TEXT_FORMATS` arrive as a
 * string in `body` and are read by an editor; `BYTE_FORMATS` arrive as nothing at all
 * and carry a `bodyUrl` the webview fetches instead, which is the only way an `<img>`
 * or a `<video>` can render a response. `binary` is the catch-all of the second group
 * and now means "show the bytes in the hex viewer" rather than "show nothing".
 *
 * `svg` sits in the textual group on purpose even though it renders as a picture: it
 * is XML, its source is worth reading, and keeping a scriptable document off the byte
 * route is what stops it being served from the app's own origin. Mirrors the constants
 * in `internal/httpexec/classify.go`.
 */
export const TEXT_FORMATS = ['json', 'ndjson', 'xml', 'html', 'svg', 'csv', 'markdown', 'yaml', 'javascript', 'css', 'sse', 'text'] as const
export const BYTE_FORMATS = ['image', 'audio', 'video', 'pdf', 'font', 'archive', 'binary'] as const

export type TextFormat = (typeof TEXT_FORMATS)[number]
export type ByteFormat = (typeof BYTE_FORMATS)[number]
export type ResponseFormat = TextFormat | ByteFormat

const BYTE_FORMAT_SET: ReadonlySet<string> = new Set(BYTE_FORMATS)

/** Narrows to the group that has no `body` and must be rendered from `bodyUrl`. */
export const isByteFormat = (format: ResponseFormat): format is ByteFormat => BYTE_FORMAT_SET.has(format)

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
 * `mode` picks how far from the raw bytes the presentation goes. `pretty` is what the
 * request editor's "Format JSON" button does minus the writing back, `raw` is exactly
 * what the server sent, and `rich` is the format's own viewer — the collapsible tree
 * for JSON, the rendered page for HTML and Markdown, the table for CSV, the event list
 * for an SSE transcript, the picture for SVG.
 *
 * One name for all of those rather than five, because they are one choice: how much
 * interpretation do you want. Naming them separately would put five members in a
 * persisted enum to express a single axis, and would make "the same view as last time"
 * meaningless across a request whose Content-Type changed.
 *
 * `null` is "nothing chosen", as it is for `language`, and it resolves to whatever
 * suits the format: source for JSON, the render for a page. See `resolveMode`.
 */
export type BodyLanguage = TextFormat
export type BodyMode = 'rich' | 'pretty' | 'raw'
export interface BodyView {
  mode: BodyMode | null
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
 * On success, `body` is empty for every format in `BYTE_FORMATS`: those bytes are
 * still deliberately not shipped across the binding — base64 would inflate them by a
 * third, hold them twice and give up Range requests — and are fetched from `bodyUrl`
 * instead. `truncated` says the body was capped, in which case `sizeBytes` is the full
 * size reported by the server rather than the length of what is on screen.
 *
 * `encoding` names the charset the payload was transcoded *from*, empty when it
 * already was UTF-8. `contentEncoding` is the compression found on the response: with
 * a readable body it was undone in Go, with a binary one the algorithm is unsupported.
 */
/**
 * The response viewer's search bar.
 *
 * `caseSensitive` and `regexp` are the two toggles the bar offers, and they are here
 * rather than local to it so that closing the bar does not silently reset them — a
 * regex you spent a minute writing should still be there on the next Ctrl+F.
 */
export interface ResponseSearch {
  open: boolean
  query: string
  caseSensitive: boolean
  regexp: boolean
}

export interface ArchiveEntry {
  name: string
  size: number
  compressedSize: number
  /** RFC 3339, or empty when the entry carried no usable timestamp. */
  modified: string
  directory: boolean
}

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
      bodyUrl: string
      headers: KeyValueRow[]
      contentType: string
      encoding: string
      contentEncoding: string
      finalUrl: string
      /** Populated for a zip response only; empty for everything else. */
      archive: ArchiveEntry[]
      format: ResponseFormat
      truncated: boolean
    }

/**
 * The one variant every body viewer takes. Named rather than re-`Extract`ed at each
 * call site, because a dozen components needing the same narrowing is exactly what a
 * type alias is for.
 */
export type SuccessResponse = Extract<ResponseSnapshot, { state: 'success' }>

export interface RequestExecutor {
  execute(request: RequestDocument, signal: AbortSignal): Promise<SuccessResponse>
  /**
   * Lets the executor drop whatever it retained for a response the UI has discarded.
   * Optional because it is a property of *how* an executor ships a payload: only one
   * that keeps bytes out of the response object has anything to release.
   */
  release?(id: string): Promise<void>
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
 * Where the update flow currently is. A discriminated union for the same reason
 * `ResponseSnapshot` is one: the modal branches on it exhaustively, so a state added
 * without a branch fails to compile rather than rendering nothing.
 *
 * `idle`, `checking` and `downloading` are silent — the modal only shows for the three
 * states that need an answer. That is what "tell me before restarting" means here: the
 * download happens without interrupting, and the question comes when it is ready.
 */
/**
 * Whether the update dialog is on screen. Exported because two places need the answer
 * and they must not drift apart: the modal decides whether to render, and the global
 * shortcut handler decides whether the keyboard belongs to the dialog. Asking `update`
 * alone would leave the shortcuts dead for the rest of the session once an update was
 * found and postponed.
 */
export const isUpdateModalOpen = (update: UpdateState, dismissed: boolean): boolean =>
  update.state !== 'idle' && update.state !== 'checking' && !dismissed

export type UpdateState =
  | { state: 'idle' }
  | { state: 'checking' }
  /** Found, and nothing downloaded yet. The click is what starts the transfer. */
  | { state: 'available'; version: string; notes: string }
  /** `total` is 0 when the size is unknown, which the bar shows as indeterminate. */
  | { state: 'downloading'; version: string; received: number; total: number }
  /**
   * Verifying the signature and unpacking. Deliberately indeterminate: the updater
   * emits no progress for these, so a bar left at 100% would look hung. Also covers
   * the install itself, right up to the process exiting.
   */
  | { state: 'preparing'; version: string }
  /** A new version exists but this install cannot replace itself — Linux, always. */
  | { state: 'manual'; version: string; notes: string }
  /** Downloading or installing failed after an update was known to exist. */
  | { state: 'error'; version: string; code: string; detail: string }

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
