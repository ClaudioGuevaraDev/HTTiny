import { create } from 'zustand'
import { translate } from './i18n'
import { DEFAULT_BODY_VIEW } from './responseBody'
import type {
  BodyView,
  CollectionNode,
  HttpMethod,
  KeyValueRow,
  Locale,
  RequestDocument,
  ResponseSnapshot,
  SplitOrientation,
  ThemePreference,
  TreeNode,
} from './types'

/**
 * Layout bounds, defined here because the store is what clamps them. They used to
 * live in `workspaceFile.ts` while `App.tsx` and the setters below each repeated the
 * literals — three copies of the same four numbers.
 *
 * `sidebarWidth` covers the rail *and* the panel, so the minimum is the old tree
 * minimum plus the rail. A width persisted before the rail existed still lands
 * inside the new range, so no migration is needed.
 */
export const SIDEBAR_WIDTH = { min: 268, max: 468, default: 330 } as const
export const SPLIT_RATIO = { min: 30, max: 72, default: 52 } as const

type Panel = 'params' | 'headers' | 'body' | 'auth'

interface AppState {
  tree: TreeNode[]
  documents: Record<string, RequestDocument>
  tabs: string[]
  activeId: string | null
  selectedNodeId: string | null
  /**
   * Which collection the sidebar is showing. The tree renders this collection's
   * children only, so this is what the rail switches — and what has to follow along
   * when a request is revealed from the command palette.
   */
  activeCollectionId: string | null
  requestPanel: Panel
  responsePanel: 'body' | 'headers'
  responses: Record<string, ResponseSnapshot>
  /**
   * How each request's response body is being shown. Keyed by request id and pruned
   * alongside `documents` and `responses`, because it is the same class of state:
   * per request, and meaningless once the request is gone. Absent means
   * `DEFAULT_BODY_VIEW` — nothing is written until something is chosen.
   */
  bodyViews: Record<string, BodyView>

  /** Most-recently-activated request ids, newest first, capped at 12. */
  recentIds: string[]

  // Persistence status, owned by persistence.ts and rendered in the sidebar footer.
  // `unavailable` is the browser dev server, which has no Wails runtime behind it;
  // `newer-version` is a workspace file written by a later build, which is read-only
  // by design rather than being silently truncated.
  persistenceState: 'loading' | 'ready' | 'unavailable' | 'newer-version'
  saveState: 'idle' | 'pending' | 'saving' | 'saved' | 'error'
  /** False when no OS credential store could be reached — tokens are session-only. */
  secretsAvailable: boolean
  /** Set when an unreadable workspace file was moved aside on load. */
  quarantinedPath: string | null
  dataDir: string

  // Layout preferences live here rather than in App's local state because two
  // independent surfaces mutate them — the workspace buttons and palette commands —
  // and AGENTS.md keeps shared state out of presentation components.
  sidebarWidth: number
  sidebarCollapsed: boolean
  splitOrientation: SplitOrientation
  splitRatio: number

  /** Applied by `theme.ts`, which resolves `system` before CSS ever sees it. */
  theme: ThemePreference
  /** Applied by `language.ts`, which pushes it into the message runtime and onto `<html lang>`. */
  language: Locale

  // Only open/closed lives here; the palette's query and highlighted index stay
  // local to the dialog, since they change on every keystroke and nothing outside
  // it reads them.
  paletteOpen: boolean
  paletteSeed: string
  /** Not persisted: an open modal is not a preference worth restoring. */
  settingsOpen: boolean

  openRequest: (id: string) => void
  closeRequest: (id: string) => void
  setActive: (id: string) => void
  selectCollection: (id: string) => void
  setSaveState: (state: AppState['saveState']) => void
  setSecretsAvailable: (available: boolean) => void
  updateDocument: (id: string, patch: Partial<RequestDocument>) => void
  setRows: (id: string, key: 'params' | 'headers', rows: KeyValueRow[]) => void
  toggleNode: (nodeId: string) => void
  addNode: (type: 'collection' | 'folder' | 'request', parentId?: string, name?: string) => void
  renameNode: (nodeId: string, name: string) => void
  deleteNode: (nodeId: string) => void
  revealNode: (requestId: string) => void
  setRequestPanel: (panel: Panel) => void
  setResponsePanel: (panel: 'body' | 'headers') => void
  setResponse: (id: string, response: ResponseSnapshot) => void
  setBodyView: (id: string, patch: Partial<BodyView>) => void
  setSidebarWidth: (width: number) => void
  toggleSidebar: () => void
  setSplitOrientation: (orientation: SplitOrientation) => void
  toggleSplitOrientation: () => void
  setSplitRatio: (ratio: number) => void
  setTheme: (theme: ThemePreference) => void
  setLanguage: (language: Locale) => void
  openPalette: (seed?: string) => void
  closePalette: () => void
  openSettings: () => void
  closeSettings: () => void
}

const mapTree = (nodes: TreeNode[], fn: (node: TreeNode) => TreeNode): TreeNode[] =>
  nodes.map(n => {
    const node = fn(n)
    return node.type !== 'request' ? { ...node, children: mapTree(node.children, fn) } : node
  })

const removeNode = (nodes: TreeNode[], id: string): TreeNode[] =>
  nodes.filter(n => n.id !== id).map(n => (n.type === 'request' ? n : { ...n, children: removeNode(n.children, id) }))

const insertNode = (nodes: TreeNode[], parentId: string | undefined, child: TreeNode): TreeNode[] => {
  if (!parentId) return [...nodes, child]
  return nodes.map(n =>
    n.id === parentId && n.type !== 'request'
      ? { ...n, expanded: true, children: [...n.children, child] }
      : n.type === 'request'
        ? n
        : { ...n, children: insertNode(n.children, parentId, child) },
  )
}

/** The tree node pointing at a given document, or null if it has been deleted. */
const findRequestNodeId = (nodes: TreeNode[], requestId: string): string | null => {
  for (const node of nodes) {
    if (node.type === 'request') {
      if (node.requestId === requestId) return node.id
      continue
    }
    const found = findRequestNodeId(node.children, requestId)
    if (found) return found
  }
  return null
}

export const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.type !== 'request') {
      const found = findNode(node.children, id)
      if (found) return found
    }
  }
  return null
}

/** Every document id in a subtree, so deleting a folder prunes its requests too. */
export const requestIdsIn = (node: TreeNode): string[] => (node.type === 'request' ? [node.requestId] : node.children.flatMap(requestIdsIn))

export interface VisibleRow {
  node: TreeNode
  depth: number
  parentId: string | null
  /** 1-based position among siblings, and the sibling count — `aria-posinset`/`aria-setsize`. */
  position: number
  siblings: number
}

/**
 * The tree flattened to exactly the rows a user can see, in visual order. This is what
 * makes keyboard navigation possible: `↑`/`↓` are a step through this array, and `←`/`→`
 * need the parent id, which the nested structure does not carry.
 *
 * Collapsed branches contribute their own row and nothing beneath it, which is the whole
 * point — arrow keys must not walk into rows that are not on screen. The flat shape is
 * also what the sidebar renders: an ARIA tree may be authored flat as long as every row
 * declares its level and position, and that avoids a wrapper element per branch.
 */
export const flattenVisible = (nodes: TreeNode[], depth = 0, parentId: string | null = null): VisibleRow[] =>
  nodes.flatMap((node, index) => {
    const row: VisibleRow = { node, depth, parentId, position: index + 1, siblings: nodes.length }
    return node.type !== 'request' && node.expanded ? [row, ...flattenVisible(node.children, depth + 1, node.id)] : [row]
  })

/** Ids of every ancestor of `id`, outermost first — used to expand a revealed row. */
const ancestorIds = (nodes: TreeNode[], id: string, trail: string[] = []): string[] | null => {
  for (const node of nodes) {
    if (node.id === id) return trail
    if (node.type !== 'request') {
      const found = ancestorIds(node.children, id, [...trail, node.id])
      if (found) return found
    }
  }
  return null
}

const remember = (recentIds: string[], id: string): string[] => [id, ...recentIds.filter(recent => recent !== id)].slice(0, 12)

/**
 * What it takes to make a request visible in the sidebar: switch to its collection,
 * expand every ancestor, select its row.
 *
 * The tree only renders one collection's children, so activating a tab without this
 * left the selection on a row that was not on screen — and `containerFor` would then
 * place a new request beside it, inside a collection you were not looking at.
 *
 * Takes `tree` rather than the whole state because `deleteNode` applies it to the
 * tree it has just pruned, not to the one still in the store. Returns its inputs
 * unchanged when the request is not in the tree — the same fallback `setActive`
 * spelled out as `?? s.selectedNodeId`.
 */
const revealPatch = (tree: TreeNode[], requestId: string | null, selectedNodeId: string | null, activeCollectionId: string | null) => {
  const nodeId = requestId ? findRequestNodeId(tree, requestId) : null
  if (!nodeId) return { tree, selectedNodeId, activeCollectionId }
  const ancestors = ancestorIds(tree, nodeId) ?? []
  // Only rebuild the tree when something is actually collapsed. `mapTree` gives every
  // node a new identity, and the autosave subscriber serialises the whole workspace
  // the moment `tree` changes reference (persistence.ts:116) — too much for a click
  // on a tab that reveals nothing.
  const collapsed = ancestors.some(id => {
    const node = findNode(tree, id)
    return node !== null && node.type !== 'request' && !node.expanded
  })
  return {
    tree: collapsed ? mapTree(tree, n => (n.type !== 'request' && ancestors.includes(n.id) ? { ...n, expanded: true } : n)) : tree,
    selectedNodeId: nodeId,
    // `ancestors[0]` is the collection: collections are always root nodes.
    activeCollectionId: ancestors[0] ?? activeCollectionId,
  }
}

/**
 * Where a new node goes when the caller does not name a parent: into the selected
 * container, or alongside the selected request, else at the root.
 *
 * Three call sites used to hardcode `'main'` — the id of a collection that existed
 * only in the deleted fixtures. `insertNode` returns the tree unchanged when no
 * node matches, so with an empty tree the sidebar's New folder and New request
 * buttons silently did nothing, and `addNode('request', 'main')` was worse than a
 * no-op: it still created the document and opened a tab, leaving a request that
 * belonged to no tree and could never be found again once the tab was closed.
 */
const containerFor = (nodes: TreeNode[], selectedNodeId: string | null, activeCollectionId: string | null): string | undefined => {
  if (selectedNodeId) {
    const node = findNode(nodes, selectedNodeId)
    if (node && node.type !== 'request') return node.id
    const parent = ancestorIds(nodes, selectedNodeId)?.at(-1)
    if (parent) return parent
  }
  // Falling back to the active collection rather than the root is what keeps a new
  // request inside the collection you are looking at. Landing it at the root would
  // now make it invisible, because the tree only renders one collection's children.
  return activeCollectionId ?? undefined
}

/** Root-level collections, in order — exactly what the rail lists. */
export const collectionsIn = (nodes: TreeNode[]): CollectionNode[] => nodes.filter((n): n is CollectionNode => n.type === 'collection')

export const useAppStore = create<AppState>(set => ({
  // The app starts genuinely empty. There are no fixtures to seed from any more:
  // demo data against a domain that does not exist made every surface look
  // populated while nothing worked, and it hid the first-run experience.
  tree: [],
  documents: {},
  tabs: [],
  activeId: null,
  selectedNodeId: null,
  activeCollectionId: null,
  requestPanel: 'params',
  responsePanel: 'body',
  responses: {},
  bodyViews: {},
  recentIds: [],
  sidebarWidth: SIDEBAR_WIDTH.default,
  sidebarCollapsed: false,
  splitOrientation: 'rows',
  splitRatio: SPLIT_RATIO.default,
  theme: 'system',
  language: 'en',
  paletteOpen: false,
  paletteSeed: '',
  settingsOpen: false,
  persistenceState: 'loading',
  saveState: 'idle',
  secretsAvailable: true,
  quarantinedPath: null,
  dataDir: '',

  // `selectedNodeId` used to be derived as `node-${activeId}`, a convention that only
  // held for the seeded fixtures in data.ts. Requests created through `addNode` got
  // ids like `request-1699…`, so they never highlighted in the tree. `revealPatch`
  // looks the node up, so selection is correct for every request however it was
  // created — and the sidebar follows it into its own collection.
  openRequest: id =>
    set(s => ({
      ...revealPatch(s.tree, id, s.selectedNodeId, s.activeCollectionId),
      tabs: s.tabs.includes(id) ? s.tabs : [...s.tabs, id],
      activeId: id,
      recentIds: remember(s.recentIds, id),
    })),

  // Closing a tab is a view operation, not a delete: the request still exists in the
  // tree, so `documents[id]` stays. The stored response stays too — finding your last
  // response still there when you reopen a tab is a feature, not a leak.
  closeRequest: id =>
    set(s => {
      const index = s.tabs.indexOf(id)
      const tabs = s.tabs.filter(tab => tab !== id)
      const activeId = s.activeId === id ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : s.activeId
      return {
        tabs,
        activeId,
        recentIds: s.recentIds.filter(recent => recent !== id),
        // Only when the neighbour tab took over. Closing a background tab must not
        // move the sidebar out from under you.
        ...(activeId === s.activeId ? {} : revealPatch(s.tree, activeId, s.selectedNodeId, s.activeCollectionId)),
      }
    }),

  // The sidebar follows the tab strip: the rail switches to the request's collection
  // and its row is revealed, so what the tree shows always matches what the editor
  // holds. The command palette has done this since it existed; tabs did not.
  setActive: id =>
    set(s => ({
      ...revealPatch(s.tree, id, s.selectedNodeId, s.activeCollectionId),
      activeId: id,
      recentIds: remember(s.recentIds, id),
    })),

  // Clears the tree selection: it belonged to the collection being left, and
  // leaving it set would keep `containerFor` placing new nodes in the old one.
  selectCollection: id => set({ activeCollectionId: id, selectedNodeId: null }),

  setSaveState: saveState => set({ saveState }),
  setSecretsAvailable: secretsAvailable => set({ secretsAvailable }),

  // There is no `dirty` flag any more. Everything autosaves, so "unsaved" was a
  // state the app could no longer be in — and a confirmation dialog guarding
  // against losing changes that were already on disk was simply lying.
  updateDocument: (id, patch) => set(s => ({ documents: { ...s.documents, [id]: { ...s.documents[id], ...patch } } })),

  setRows: (id, key, rows) => set(s => ({ documents: { ...s.documents, [id]: { ...s.documents[id], [key]: rows } } })),

  toggleNode: nodeId => set(s => ({ tree: mapTree(s.tree, n => (n.id === nodeId && n.type !== 'request' ? { ...n, expanded: !n.expanded } : n)) })),

  addNode: (type, parentId, name) =>
    set(s => {
      const stamp = Date.now()

      // A request or folder always ends up inside a collection, the way a channel
      // always belongs to a server. Without this an empty workspace would put the
      // first request at the root, where the collection-scoped tree cannot show it.
      let tree = s.tree
      let activeCollectionId = s.activeCollectionId
      if (type !== 'collection' && !parentId && !collectionsIn(tree).length) {
        activeCollectionId = `collection-${stamp}`
        tree = [...tree, { id: activeCollectionId, type: 'collection', name: translate('data.myCollection'), expanded: true, children: [] }]
      }

      const parent = parentId ?? containerFor(tree, s.selectedNodeId, activeCollectionId)
      if (type === 'request') {
        // The node id and the document id were both `request-${Date.now()}` in the
        // same tick, so they came out identical — a latent collision between tree
        // identity and document key. They are now distinct by construction.
        const nodeId = `node-${stamp}`
        const requestId = `request-${stamp}`
        const doc: RequestDocument = {
          id: requestId,
          kind: 'http',
          // Named in the app's language and then stored as ordinary user data, which is
          // what it is: switching language later does not rename anything that exists,
          // because by then the name is content and not copy.
          name: name?.trim() || translate('data.newRequest'),
          method: 'GET',
          // Empty rather than a `https://` stub: the input's placeholder already
          // shows the expected shape, and a prefilled scheme has to be deleted
          // before a pasted URL will go in.
          url: '',
          params: [{ id: `${requestId}-p`, enabled: true, key: '', value: '', description: '' }],
          headers: [{ id: `${requestId}-h`, enabled: true, key: '', value: '', description: '' }],
          body: { type: 'none', content: '' },
          auth: { type: 'none', token: '', username: '', password: '' },
        }
        return {
          tree: insertNode(tree, parent, { id: nodeId, type, requestId, name: doc.name }),
          documents: { ...s.documents, [requestId]: doc },
          tabs: [...s.tabs, requestId],
          activeId: requestId,
          selectedNodeId: nodeId,
          activeCollectionId,
          recentIds: remember(s.recentIds, requestId),
        }
      }
      const id = `${type}-${stamp}`
      const child: TreeNode = {
        id,
        type,
        name: name?.trim() || translate(type === 'collection' ? 'data.newCollection' : 'data.newFolder'),
        expanded: true,
        children: [],
      }
      return {
        // A collection is always a root node, whatever happens to be selected —
        // nesting one inside a folder would hide it from the rail.
        tree: insertNode(tree, type === 'collection' ? undefined : parent, child),
        selectedNodeId: type === 'collection' ? null : id,
        // A new collection becomes the one you are looking at, so the panel is not
        // still showing the previous one's contents under its name.
        activeCollectionId: type === 'collection' ? id : activeCollectionId,
      }
    }),

  renameNode: (nodeId, name) =>
    set(s => {
      let requestId: string | undefined
      const tree = mapTree(s.tree, n => {
        if (n.id !== nodeId) return n
        if (n.type === 'request') requestId = n.requestId
        return { ...n, name }
      })
      return { tree, documents: requestId ? { ...s.documents, [requestId]: { ...s.documents[requestId], name } } : s.documents }
    }),

  // Used to touch only `tree` and `selectedNodeId`, which left the deleted request's
  // document, tab and stored response behind — you could keep editing a tab backed by
  // a document that no longer existed anywhere in the tree. Deleting a folder now
  // prunes every request beneath it, because `requestIdsIn` walks the subtree the
  // same way `removeNode` drops it.
  deleteNode: nodeId =>
    set(s => {
      const target = findNode(s.tree, nodeId)
      const removed = target ? requestIdsIn(target) : []
      const documents = { ...s.documents }
      const responses = { ...s.responses }
      const bodyViews = { ...s.bodyViews }
      removed.forEach(id => {
        delete documents[id]
        delete responses[id]
        delete bodyViews[id]
      })
      const index = s.activeId ? s.tabs.indexOf(s.activeId) : -1
      const tabs = s.tabs.filter(tab => !removed.includes(tab))
      const activeId = s.activeId && removed.includes(s.activeId) ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : s.activeId

      const tree = removeNode(s.tree, nodeId)
      // Deleting the collection you were looking at has to leave the rail pointing
      // somewhere, or the panel renders under a name that no longer exists.
      const collections = collectionsIn(tree)
      const activeCollectionId =
        s.activeCollectionId && collections.some(c => c.id === s.activeCollectionId) ? s.activeCollectionId : (collections[0]?.id ?? null)

      // Was only cleared when the selection *was* the deleted node, so deleting a
      // folder left `selectedNodeId` pointing inside the subtree that just went
      // away — a dangling id that `containerFor` would then resolve against.
      const selectedNodeId = s.selectedNodeId && findNode(tree, s.selectedNodeId) ? s.selectedNodeId : null

      return {
        tree,
        documents,
        responses,
        bodyViews,
        tabs,
        activeId,
        activeCollectionId,
        selectedNodeId,
        recentIds: s.recentIds.filter(recent => !removed.includes(recent)),
        // Same rule as closing a tab, against the pruned tree and the already
        // validated ids: follow the request that took over, and only then — deleting
        // an unrelated folder must not yank the selection across the panel.
        ...(activeId === s.activeId ? {} : revealPatch(tree, activeId, selectedNodeId, activeCollectionId)),
      }
    }),

  /**
   * Reveal a request without activating it — the palette's "Reveal in sidebar".
   *
   * The palette's other two paths used to call this straight after `setActive` /
   * `openRequest`; they no longer need to, because those actions reveal on their own.
   */
  revealNode: requestId => set(s => revealPatch(s.tree, requestId, s.selectedNodeId, s.activeCollectionId)),

  setRequestPanel: requestPanel => set({ requestPanel }),
  setResponsePanel: responsePanel => set({ responsePanel }),
  setResponse: (id, response) => set(s => ({ responses: { ...s.responses, [id]: response } })),
  // Merged over the default rather than over the stored entry alone, so setting one
  // field on a request that has never been touched still yields a whole `BodyView`.
  setBodyView: (id, patch) => set(s => ({ bodyViews: { ...s.bodyViews, [id]: { ...DEFAULT_BODY_VIEW, ...s.bodyViews[id], ...patch } } })),

  setSidebarWidth: width => set({ sidebarWidth: Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)) }),
  toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSplitOrientation: splitOrientation => set({ splitOrientation }),
  toggleSplitOrientation: () => set(s => ({ splitOrientation: s.splitOrientation === 'rows' ? 'columns' : 'rows' })),
  setSplitRatio: ratio => set({ splitRatio: Math.min(SPLIT_RATIO.max, Math.max(SPLIT_RATIO.min, ratio)) }),
  setTheme: theme => set({ theme }),
  setLanguage: language => set({ language }),
  openPalette: (seed = '') => set({ paletteOpen: true, paletteSeed: seed }),
  closePalette: () => set({ paletteOpen: false, paletteSeed: '' }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}))

/**
 * `base?query#hash`, split once so the two directions of the URL/params sync cannot
 * disagree about where the query starts. `replaceQuery` writes rows into a URL and
 * `parseParams` reads them back out; both go through here.
 *
 * The fragment wins: `?a=1` after a `#` is part of the fragment, not the query.
 */
export const splitUrl = (url: string): { base: string; query: string; hash: string } => {
  const hashAt = url.indexOf('#')
  const hash = hashAt >= 0 ? url.slice(hashAt) : ''
  const clean = hashAt >= 0 ? url.slice(0, hashAt) : url
  const queryAt = clean.indexOf('?')
  return queryAt >= 0 ? { base: clean.slice(0, queryAt), query: clean.slice(queryAt + 1), hash } : { base: clean, query: '', hash }
}

export const replaceQuery = (url: string, rows: KeyValueRow[]) => {
  const { base, hash } = splitUrl(url)
  const query = rows
    .filter(r => r.enabled && r.key.trim())
    .map(r => `${encodeURIComponent(r.key)}=${encodeURIComponent(r.value)}`)
    .join('&')
  return `${base}${query ? `?${query}` : ''}${hash}`
}

export const methodOptions: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
