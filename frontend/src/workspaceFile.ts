import { BODY_LANGUAGES, BODY_MODES, DEFAULT_BODY_VIEW } from './responseBody'
import { SIDEBAR_WIDTH, SPLIT_RATIO, methodOptions } from './store'
import type { BodyView, HttpMethod, KeyValueRow, Locale, RequestDocument, SplitOrientation, ThemePreference, TreeNode } from './types'

/**
 * The on-disk schema.
 *
 * Go stores this number verbatim and never interprets it. Bump it whenever a change
 * to the payload cannot be absorbed by the defaults in the validators below — a
 * renamed field, a changed union member, a restructured node. Purely additive
 * changes do not need a bump, because every reader here already supplies a default.
 *
 * With no test framework in this project, nothing catches a forgotten bump. The
 * validators are therefore written to degrade rather than throw.
 */
export const WORKSPACE_VERSION = 1
export const PREFS_VERSION = 1

/**
 * Disk shapes, deliberately decoupled from the in-memory ones.
 *
 * Three fields are dropped on the way out and rebuilt on the way in:
 * - `dirty` no longer exists at all now that everything autosaves.
 * - `expanded` is view state and lives in the prefs file, as `collapsedNodeIds`.
 * - `RequestNode.name` is a denormalised copy of `documents[requestId].name`
 *   (see types.ts); on disk it is a field that can disagree with itself.
 *
 * `auth.token` and `auth.password` are also absent by construction — they go to the
 * OS credential store, never to this file. See internal/secrets.
 */
interface StoredAuth {
  type: RequestDocument['auth']['type']
  username: string
}
interface StoredDocument {
  id: string
  name: string
  method: HttpMethod
  url: string
  params: KeyValueRow[]
  headers: KeyValueRow[]
  body: RequestDocument['body']
  auth: StoredAuth
}
type StoredNode =
  | { id: string; type: 'collection' | 'folder'; name: string; children: StoredNode[] }
  | { id: string; type: 'request'; requestId: string }

export interface WorkspaceFile {
  tree: StoredNode[]
  documents: Record<string, StoredDocument>
}

export interface PrefsFile {
  tabs: string[]
  activeId: string | null
  selectedNodeId: string | null
  activeCollectionId: string | null
  recentIds: string[]
  collapsedNodeIds: string[]
  requestPanel: 'params' | 'headers' | 'body' | 'auth'
  responsePanel: 'body' | 'headers'
  /**
   * Only the requests whose view differs from the default appear here. Writing an
   * entry per request would grow this file in lockstep with the workspace to record
   * that nothing was chosen.
   */
  bodyViews: Record<string, BodyView>
  sidebarWidth: number
  sidebarCollapsed: boolean
  splitOrientation: SplitOrientation
  splitRatio: number
  theme: ThemePreference
  language: Locale
}

// ── Writing ────────────────────────────────────────────────────────────────────

const collapsedIn = (nodes: TreeNode[], out: string[] = []): string[] => {
  for (const node of nodes) {
    if (node.type === 'request') continue
    if (!node.expanded) out.push(node.id)
    collapsedIn(node.children, out)
  }
  return out
}

const toStoredNode = (node: TreeNode): StoredNode =>
  node.type === 'request'
    ? { id: node.id, type: 'request', requestId: node.requestId }
    : { id: node.id, type: node.type, name: node.name, children: node.children.map(toStoredNode) }

const toStoredDocument = (doc: RequestDocument): StoredDocument => ({
  id: doc.id,
  name: doc.name,
  method: doc.method,
  url: doc.url,
  params: doc.params,
  headers: doc.headers,
  body: doc.body,
  auth: { type: doc.auth.type, username: doc.auth.username },
})

export const toWorkspaceFile = (state: { tree: TreeNode[]; documents: Record<string, RequestDocument> }): WorkspaceFile => ({
  tree: state.tree.map(toStoredNode),
  documents: Object.fromEntries(Object.entries(state.documents).map(([id, doc]) => [id, toStoredDocument(doc)])),
})

/** A request showing its body the default way records nothing — see `PrefsFile`. */
const nonDefaultViews = (views: Record<string, BodyView>): Record<string, BodyView> =>
  Object.fromEntries(Object.entries(views).filter(([, view]) => view.mode !== DEFAULT_BODY_VIEW.mode || view.language !== DEFAULT_BODY_VIEW.language))

export const toPrefsFile = (state: {
  tree: TreeNode[]
  tabs: string[]
  activeId: string | null
  selectedNodeId: string | null
  activeCollectionId: string | null
  recentIds: string[]
  requestPanel: PrefsFile['requestPanel']
  responsePanel: PrefsFile['responsePanel']
  bodyViews: Record<string, BodyView>
  sidebarWidth: number
  sidebarCollapsed: boolean
  splitOrientation: SplitOrientation
  splitRatio: number
  theme: ThemePreference
  language: Locale
}): PrefsFile => ({
  tabs: state.tabs,
  activeId: state.activeId,
  selectedNodeId: state.selectedNodeId,
  activeCollectionId: state.activeCollectionId,
  recentIds: state.recentIds,
  collapsedNodeIds: collapsedIn(state.tree),
  requestPanel: state.requestPanel,
  responsePanel: state.responsePanel,
  bodyViews: nonDefaultViews(state.bodyViews),
  sidebarWidth: state.sidebarWidth,
  sidebarCollapsed: state.sidebarCollapsed,
  splitOrientation: state.splitOrientation,
  splitRatio: state.splitRatio,
  theme: state.theme,
  language: state.language,
})

// ── Reading ────────────────────────────────────────────────────────────────────
//
// Everything below is defensive on purpose. This is the one place where data the
// app did not write enters it — a hand edit, a file from a newer build, a partial
// sync — so nothing is asserted with `as` and every field has a fallback.
//
// The names those fallbacks supply — 'Untitled', 'Collection', 'Folder' — stay in
// English, unlike the names `store.ts` gives to nodes the user creates. They are
// repair markers on a damaged file rather than copy, they are most useful when they
// read the same in every bug report, and they are produced during hydration, before
// the stored language has been applied.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const clamped = (v: unknown, range: { min: number; max: number; default: number }): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(range.max, Math.max(range.min, v)) : range.default
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback

const BODY_TYPES = ['none', 'json', 'text'] as const
const AUTH_TYPES = ['none', 'bearer', 'basic'] as const
const PANELS = ['params', 'headers', 'body', 'auth'] as const
const RESPONSE_PANELS = ['body', 'headers'] as const

/**
 * Dropped for requests that no longer exist, the same way `tabs` and `recentIds`
 * are: a view kept for a deleted request can never be reached or cleared, so it
 * would only accumulate.
 */
const readBodyViews = (value: unknown, documents: Record<string, RequestDocument>): Record<string, BodyView> => {
  if (!isRecord(value)) return {}
  const out: Record<string, BodyView> = {}
  for (const [id, view] of Object.entries(value)) {
    if (!documents[id] || !isRecord(view)) continue
    out[id] = {
      mode: oneOf(view.mode, BODY_MODES, DEFAULT_BODY_VIEW.mode),
      // Not `oneOf`: the fallback here is `null` — no language chosen — which is not
      // one of the allowed values.
      language: BODY_LANGUAGES.find(candidate => candidate === view.language) ?? null,
    }
  }
  return out
}
const ORIENTATIONS = ['rows', 'columns'] as const
const THEMES = ['system', 'light', 'dark'] as const
/** `satisfies` so a locale that has no catalogue cannot be listed here as readable. */
const LOCALES = ['en', 'es'] as const satisfies readonly Locale[]

const readRows = (value: unknown, prefix: string): KeyValueRow[] => {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((row, index) => ({
    // A missing or duplicated id would collide as a React key, so it is always
    // regenerated from the position rather than trusted.
    id: str(row.id) || `${prefix}-${index}`,
    enabled: bool(row.enabled, true),
    key: str(row.key),
    value: str(row.value),
    description: str(row.description),
  }))
}

const readDocument = (value: unknown, id: string): RequestDocument | null => {
  if (!isRecord(value)) return null
  const body = isRecord(value.body) ? value.body : {}
  const auth = isRecord(value.auth) ? value.auth : {}
  return {
    id,
    kind: 'http',
    name: str(value.name, 'Untitled'),
    method: oneOf<HttpMethod>(value.method, methodOptions, 'GET'),
    url: str(value.url),
    params: readRows(value.params, `${id}-p`),
    headers: readRows(value.headers, `${id}-h`),
    body: { type: oneOf(body.type, BODY_TYPES, 'none'), content: str(body.content) },
    // Credentials are restored separately from the OS credential store; a
    // workspace opened on another machine simply has none.
    auth: { type: oneOf(auth.type, AUTH_TYPES, 'none'), token: '', username: str(auth.username), password: '' },
  }
}

/**
 * Rebuilds the tree, dropping anything that cannot be rendered: request nodes whose
 * document is missing, and duplicate ids. Hand editing produces valid JSON with
 * broken references far more often than it produces broken JSON.
 */
const readTree = (value: unknown, documents: Record<string, RequestDocument>, collapsed: Set<string>, seen: Set<string>): TreeNode[] => {
  if (!Array.isArray(value)) return []
  const out: TreeNode[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const id = str(raw.id)
    if (!id || seen.has(id)) continue

    if (raw.type === 'request') {
      const requestId = str(raw.requestId)
      const doc = documents[requestId]
      if (!doc) continue
      seen.add(id)
      // `name` is rebuilt from the document rather than read, so the two can never
      // be restored disagreeing with each other.
      out.push({ id, type: 'request', requestId, name: doc.name })
      continue
    }
    if (raw.type !== 'collection' && raw.type !== 'folder') continue
    seen.add(id)
    out.push({
      id,
      type: raw.type,
      name: str(raw.name, raw.type === 'collection' ? 'Collection' : 'Folder'),
      expanded: !collapsed.has(id),
      children: readTree(raw.children, documents, collapsed, seen),
    })
  }
  return out
}

/** Every document id reachable from the tree — anything else is unreachable and dropped. */
const reachable = (nodes: TreeNode[], out: Set<string> = new Set()): Set<string> => {
  for (const node of nodes) {
    if (node.type === 'request') out.add(node.requestId)
    else reachable(node.children, out)
  }
  return out
}

/**
 * Moves any root-level folder or request into a collection.
 *
 * The sidebar only renders one collection's children, so anything left loose at the
 * root would be unreachable through the UI — invisible, undeletable, and still
 * taking up space in the file. Hand-edited workspaces and files written before the
 * rail existed are both sources of these, so the reader repairs rather than trusts.
 */
const adopt = (nodes: TreeNode[]): TreeNode[] => {
  const stray = nodes.filter(node => node.type !== 'collection')
  if (!stray.length) return nodes

  const collections = nodes.filter(node => node.type === 'collection')
  const first = collections[0]
  if (first && first.type === 'collection') {
    return [{ ...first, children: [...first.children, ...stray] }, ...collections.slice(1)]
  }
  return [{ id: 'collection-recovered', type: 'collection', name: 'My Collection', expanded: true, children: stray }]
}

export interface LoadedWorkspace {
  tree: TreeNode[]
  documents: Record<string, RequestDocument>
}

export function readWorkspace(payload: unknown, collapsedNodeIds: readonly string[]): LoadedWorkspace {
  if (!isRecord(payload)) return { tree: [], documents: {} }

  const documents: Record<string, RequestDocument> = {}
  if (isRecord(payload.documents)) {
    for (const [id, raw] of Object.entries(payload.documents)) {
      const doc = readDocument(raw, id)
      if (doc) documents[id] = doc
    }
  }

  const tree = adopt(readTree(payload.tree, documents, new Set(collapsedNodeIds), new Set()))

  // Drop orphans: a document no node points at can never be opened or deleted
  // through the UI, so keeping it would only grow the file forever.
  const live = reachable(tree)
  for (const id of Object.keys(documents)) {
    if (!live.has(id)) delete documents[id]
  }

  return { tree, documents }
}

export function readPrefs(payload: unknown, documents: Record<string, RequestDocument>, tree: TreeNode[]): PrefsFile {
  const raw = isRecord(payload) ? payload : {}
  const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])

  // Restoring a tab for a request that no longer exists would render an empty tab
  // strip entry, so the session is filtered down to what actually survived.
  const tabs = ids(raw.tabs).filter(id => documents[id])
  const activeCandidate = typeof raw.activeId === 'string' ? raw.activeId : null
  const activeId = activeCandidate && tabs.includes(activeCandidate) ? activeCandidate : (tabs[tabs.length - 1] ?? null)

  const nodeIds = new Set<string>()
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      nodeIds.add(node.id)
      if (node.type !== 'request') walk(node.children)
    }
  }
  walk(tree)
  const selectedCandidate = typeof raw.selectedNodeId === 'string' ? raw.selectedNodeId : null

  // Falls back to the first collection rather than to null: with the tree scoped to
  // the active collection, a null here would render an empty panel on a workspace
  // that plainly has collections in it.
  const collectionIds = tree.filter(node => node.type === 'collection').map(node => node.id)
  const collectionCandidate = typeof raw.activeCollectionId === 'string' ? raw.activeCollectionId : null

  return {
    tabs,
    activeId,
    selectedNodeId: selectedCandidate && nodeIds.has(selectedCandidate) ? selectedCandidate : null,
    activeCollectionId: collectionCandidate && collectionIds.includes(collectionCandidate) ? collectionCandidate : (collectionIds[0] ?? null),
    recentIds: ids(raw.recentIds).filter(id => documents[id]).slice(0, 12),
    collapsedNodeIds: ids(raw.collapsedNodeIds),
    requestPanel: oneOf(raw.requestPanel, PANELS, 'params'),
    responsePanel: oneOf(raw.responsePanel, RESPONSE_PANELS, 'body'),
    bodyViews: readBodyViews(raw.bodyViews, documents),
    sidebarWidth: clamped(raw.sidebarWidth, SIDEBAR_WIDTH),
    sidebarCollapsed: bool(raw.sidebarCollapsed, false),
    splitOrientation: oneOf(raw.splitOrientation, ORIENTATIONS, 'rows'),
    splitRatio: clamped(raw.splitRatio, SPLIT_RATIO),
    theme: oneOf(raw.theme, THEMES, 'system'),
    language: oneOf(raw.language, LOCALES, 'en'),
  }
}

/** `collapsedNodeIds` is needed to build the tree, so it is read before the rest. */
export const readCollapsed = (payload: unknown): string[] => {
  if (!isRecord(payload) || !Array.isArray(payload.collapsedNodeIds)) return []
  return payload.collapsedNodeIds.filter((v): v is string => typeof v === 'string')
}
