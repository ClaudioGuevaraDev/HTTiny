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
  auth: { type: 'none' | 'bearer' | 'basic'; token: string; username: string; password: string }
  dirty: boolean
}
/**
 * `sizeBytes` is a number rather than a pre-baked `'1.2 KB'` string: formatting is
 * the view's job, and a real network executor hands back a byte count. `startedAt`
 * lets the loading state render a live elapsed counter without a second source of
 * truth, and `code` keeps the raw failure code so the UI can special-case it.
 */
export type ResponseSnapshot =
  | { state: 'idle' }
  | { state: 'loading'; startedAt: number }
  | { state: 'error'; code: string; message: string; detail: string }
  | { state: 'success'; status: number; statusText: string; time: number; sizeBytes: number; body: string; headers: KeyValueRow[] }

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
