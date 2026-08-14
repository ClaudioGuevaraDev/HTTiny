import { create } from 'zustand'
import { initialDocuments, initialTree } from './data'
import type { HttpMethod, KeyValueRow, RequestDocument, ResponseSnapshot, SplitOrientation, TreeNode } from './types'

type Panel = 'params' | 'headers' | 'body' | 'auth'

interface AppState {
  tree: TreeNode[]
  documents: Record<string, RequestDocument>
  tabs: string[]
  activeId: string | null
  selectedNodeId: string | null
  requestPanel: Panel
  responsePanel: 'body' | 'headers'
  responses: Record<string, ResponseSnapshot>

  /** Most-recently-activated request ids, newest first, capped at 12. */
  recentIds: string[]

  // Layout preferences live here rather than in App's local state because two
  // independent surfaces mutate them — the workspace buttons and palette commands —
  // and AGENTS.md keeps shared state out of presentation components.
  sidebarWidth: number
  sidebarCollapsed: boolean
  splitOrientation: SplitOrientation
  splitRatio: number

  // Only open/closed lives here; the palette's query and highlighted index stay
  // local to the dialog, since they change on every keystroke and nothing outside
  // it reads them.
  paletteOpen: boolean
  paletteSeed: string

  openRequest: (id: string) => void
  closeRequest: (id: string) => void
  setActive: (id: string) => void
  save: (id: string) => void
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
  setSidebarWidth: (width: number) => void
  toggleSidebar: () => void
  setSplitOrientation: (orientation: SplitOrientation) => void
  toggleSplitOrientation: () => void
  setSplitRatio: (ratio: number) => void
  openPalette: (seed?: string) => void
  closePalette: () => void
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

const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
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
const requestIdsIn = (node: TreeNode): string[] => (node.type === 'request' ? [node.requestId] : node.children.flatMap(requestIdsIn))

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

export const useAppStore = create<AppState>(set => ({
  tree: initialTree,
  documents: initialDocuments,
  tabs: ['users', 'createUser', 'login'],
  activeId: 'users',
  selectedNodeId: 'node-users',
  requestPanel: 'params',
  responsePanel: 'body',
  responses: {},
  recentIds: ['users'],
  sidebarWidth: 282,
  sidebarCollapsed: false,
  splitOrientation: 'rows',
  splitRatio: 52,
  paletteOpen: false,
  paletteSeed: '',

  // `selectedNodeId` used to be derived as `node-${activeId}`, a convention that only
  // held for the seeded fixtures in data.ts. Requests created through `addNode` got
  // ids like `request-1699…`, so they never highlighted in the tree. Looking the node
  // up keeps selection correct for every request, however it was created.
  openRequest: id =>
    set(s => ({
      tabs: s.tabs.includes(id) ? s.tabs : [...s.tabs, id],
      activeId: id,
      selectedNodeId: findRequestNodeId(s.tree, id) ?? s.selectedNodeId,
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
      return { tabs, activeId, recentIds: s.recentIds.filter(recent => recent !== id) }
    }),

  setActive: id =>
    set(s => ({
      activeId: id,
      selectedNodeId: findRequestNodeId(s.tree, id) ?? s.selectedNodeId,
      recentIds: remember(s.recentIds, id),
    })),

  save: id => set(s => ({ documents: { ...s.documents, [id]: { ...s.documents[id], dirty: false } } })),

  updateDocument: (id, patch) => set(s => ({ documents: { ...s.documents, [id]: { ...s.documents[id], ...patch, dirty: true } } })),

  setRows: (id, key, rows) => set(s => ({ documents: { ...s.documents, [id]: { ...s.documents[id], [key]: rows, dirty: true } } })),

  toggleNode: nodeId => set(s => ({ tree: mapTree(s.tree, n => (n.id === nodeId && n.type !== 'request' ? { ...n, expanded: !n.expanded } : n)) })),

  addNode: (type, parentId, name) =>
    set(s => {
      const stamp = Date.now()
      if (type === 'request') {
        // The node id and the document id were both `request-${Date.now()}` in the
        // same tick, so they came out identical — a latent collision between tree
        // identity and document key. They are now distinct by construction.
        const nodeId = `node-${stamp}`
        const requestId = `request-${stamp}`
        const doc: RequestDocument = {
          id: requestId,
          kind: 'http',
          name: name?.trim() || 'New Request',
          method: 'GET',
          url: 'https://',
          dirty: true,
          params: [{ id: `${requestId}-p`, enabled: true, key: '', value: '', description: '' }],
          headers: [{ id: `${requestId}-h`, enabled: true, key: '', value: '', description: '' }],
          body: { type: 'none', content: '' },
          auth: { type: 'none', token: '', username: '', password: '' },
        }
        return {
          tree: insertNode(s.tree, parentId, { id: nodeId, type, requestId, name: doc.name }),
          documents: { ...s.documents, [requestId]: doc },
          tabs: [...s.tabs, requestId],
          activeId: requestId,
          selectedNodeId: nodeId,
          recentIds: remember(s.recentIds, requestId),
        }
      }
      const id = `${type}-${stamp}`
      const child: TreeNode = {
        id,
        type,
        name: name?.trim() || (type === 'collection' ? 'New Collection' : 'New Folder'),
        expanded: true,
        children: [],
      }
      return { tree: insertNode(s.tree, parentId, child), selectedNodeId: id }
    }),

  renameNode: (nodeId, name) =>
    set(s => {
      let requestId: string | undefined
      const tree = mapTree(s.tree, n => {
        if (n.id !== nodeId) return n
        if (n.type === 'request') requestId = n.requestId
        return { ...n, name }
      })
      return { tree, documents: requestId ? { ...s.documents, [requestId]: { ...s.documents[requestId], name, dirty: true } } : s.documents }
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
      removed.forEach(id => {
        delete documents[id]
        delete responses[id]
      })
      const index = s.activeId ? s.tabs.indexOf(s.activeId) : -1
      const tabs = s.tabs.filter(tab => !removed.includes(tab))
      const activeId = s.activeId && removed.includes(s.activeId) ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : s.activeId
      return {
        tree: removeNode(s.tree, nodeId),
        documents,
        responses,
        tabs,
        activeId,
        recentIds: s.recentIds.filter(recent => !removed.includes(recent)),
        selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
      }
    }),

  /**
   * Expand every ancestor of a request and select it, so jumping there from the
   * command palette scrolls the sidebar to the row instead of leaving it collapsed.
   */
  revealNode: requestId =>
    set(s => {
      const nodeId = findRequestNodeId(s.tree, requestId)
      if (!nodeId) return {}
      const ancestors = ancestorIds(s.tree, nodeId) ?? []
      return {
        tree: mapTree(s.tree, n => (n.type !== 'request' && ancestors.includes(n.id) ? { ...n, expanded: true } : n)),
        selectedNodeId: nodeId,
      }
    }),

  setRequestPanel: requestPanel => set({ requestPanel }),
  setResponsePanel: responsePanel => set({ responsePanel }),
  setResponse: (id, response) => set(s => ({ responses: { ...s.responses, [id]: response } })),

  setSidebarWidth: width => set({ sidebarWidth: Math.min(420, Math.max(220, width)) }),
  toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSplitOrientation: splitOrientation => set({ splitOrientation }),
  toggleSplitOrientation: () => set(s => ({ splitOrientation: s.splitOrientation === 'rows' ? 'columns' : 'rows' })),
  setSplitRatio: ratio => set({ splitRatio: Math.min(72, Math.max(30, ratio)) }),
  openPalette: (seed = '') => set({ paletteOpen: true, paletteSeed: seed }),
  closePalette: () => set({ paletteOpen: false, paletteSeed: '' }),
}))

export const replaceQuery = (url: string, rows: KeyValueRow[]) => {
  const hashAt = url.indexOf('#')
  const hash = hashAt >= 0 ? url.slice(hashAt) : ''
  const clean = hashAt >= 0 ? url.slice(0, hashAt) : url
  const base = clean.split('?')[0]
  const query = rows
    .filter(r => r.enabled && r.key.trim())
    .map(r => `${encodeURIComponent(r.key)}=${encodeURIComponent(r.value)}`)
    .join('&')
  return `${base}${query ? `?${query}` : ''}${hash}`
}

export const methodOptions: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
