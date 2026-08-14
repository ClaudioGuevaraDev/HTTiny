export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
export type TreeNode = CollectionNode | FolderNode | RequestNode

export interface CollectionNode { id: string; type: 'collection'; name: string; expanded: boolean; children: TreeNode[] }
export interface FolderNode { id: string; type: 'folder'; name: string; expanded: boolean; children: TreeNode[] }
export interface RequestNode { id: string; type: 'request'; requestId: string; name: string; method: HttpMethod }
export interface KeyValueRow { id: string; enabled: boolean; key: string; value: string; description: string }
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
export type ResponseSnapshot =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string; detail: string }
  | { state: 'success'; status: number; statusText: string; time: number; size: string; body: string; headers: KeyValueRow[] }

export interface RequestExecutor {
  execute(request: RequestDocument, signal: AbortSignal): Promise<Extract<ResponseSnapshot, { state: 'success' }>>
}

export const methodColor: Record<HttpMethod, string> = {
  GET: 'text-emerald-400', POST: 'text-amber-400', PUT: 'text-sky-400', PATCH: 'text-violet-400',
  DELETE: 'text-rose-400', HEAD: 'text-cyan-400', OPTIONS: 'text-zinc-400',
}

