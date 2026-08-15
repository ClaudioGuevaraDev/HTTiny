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
 * a fact — JSON served as `text/plain` is common enough that "interpret this as
 * JSON" has to be reachable. `binary` is not offered: those bytes never cross the
 * binding, so there is nothing to interpret.
 *
 * `null` is "nothing chosen yet", not a menu entry: the picker offers four real
 * languages and starts on whatever the response turned out to be. Once a request has
 * been given one it keeps it, which is the point of choosing.
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
 * truth, and `code` keeps the raw failure code so the UI can special-case it.
 *
 * On success, `body` is empty when `format` is `binary`: the bytes are deliberately
 * never shipped across the binding, so the viewer renders from the metadata alone.
 * `truncated` says the body was capped, in which case `sizeBytes` is the full size
 * reported by the server rather than the length of what is on screen.
 */
export type ResponseSnapshot =
  | { state: 'idle' }
  | { state: 'loading'; startedAt: number }
  | { state: 'error'; code: string; message: string; detail: string }
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

export type MethodToken = Lowercase<HttpMethod>
export const methodToken = (method: HttpMethod): MethodToken => method.toLowerCase() as MethodToken

/**
 * Abbreviated labels for narrow contexts. The tab strip used to show only the first
 * letter of the method, which made POST, PUT and PATCH all render as "P" with colour
 * as the only difference between them.
 */
export const methodLabel: Record<HttpMethod, string> = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DEL',
  HEAD: 'HEAD',
  OPTIONS: 'OPTS',
}
