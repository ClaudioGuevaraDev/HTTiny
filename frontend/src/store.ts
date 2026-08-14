import { create } from 'zustand'
import { initialDocuments, initialTree } from './data'
import type { HttpMethod, KeyValueRow, RequestDocument, ResponseSnapshot, TreeNode } from './types'

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
  openRequest: (id: string) => void
  closeRequest: (id: string) => void
  setActive: (id: string) => void
  save: (id: string) => void
  updateDocument: (id: string, patch: Partial<RequestDocument>) => void
  setRows: (id: string, key: 'params' | 'headers', rows: KeyValueRow[]) => void
  toggleNode: (nodeId: string) => void
  addNode: (type: 'collection' | 'folder' | 'request', parentId?: string) => void
  renameNode: (nodeId: string, name: string) => void
  deleteNode: (nodeId: string) => void
  setRequestPanel: (panel: Panel) => void
  setResponsePanel: (panel: 'body' | 'headers') => void
  setResponse: (id: string, response: ResponseSnapshot) => void
}

const mapTree = (nodes: TreeNode[], fn: (node: TreeNode) => TreeNode): TreeNode[] => nodes.map(n => {
  const node = fn(n)
  return node.type !== 'request' ? { ...node, children: mapTree(node.children, fn) } : node
})
const removeNode = (nodes: TreeNode[], id: string): TreeNode[] => nodes.filter(n => n.id !== id).map(n => n.type === 'request' ? n : { ...n, children: removeNode(n.children, id) })
const insertNode = (nodes: TreeNode[], parentId: string | undefined, child: TreeNode): TreeNode[] => {
  if (!parentId) return [...nodes, child]
  return nodes.map(n => n.id === parentId && n.type !== 'request'
    ? { ...n, expanded: true, children: [...n.children, child] }
    : n.type === 'request' ? n : { ...n, children: insertNode(n.children, parentId, child) })
}

export const useAppStore = create<AppState>((set) => ({
  tree: initialTree,
  documents: initialDocuments,
  tabs: ['users', 'createUser', 'login'],
  activeId: 'users',
  selectedNodeId: 'node-users',
  requestPanel: 'params', responsePanel: 'body', responses: {},
  openRequest: id => set(s => ({ tabs: s.tabs.includes(id) ? s.tabs : [...s.tabs, id], activeId: id, selectedNodeId: `node-${id}` })),
  closeRequest: id => set(s => {
    const index = s.tabs.indexOf(id)
    const tabs = s.tabs.filter(tab => tab !== id)
    const activeId = s.activeId === id ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : s.activeId
    return { tabs, activeId }
  }),
  setActive: activeId => set({ activeId, selectedNodeId: `node-${activeId}` }),
  save: id => set(s => ({ documents: { ...s.documents, [id]: { ...s.documents[id], dirty: false } } })),
  updateDocument: (id, patch) => set(s => ({ documents: { ...s.documents, [id]: { ...s.documents[id], ...patch, dirty: true } } })),
  setRows: (id, key, rows) => set(s => ({ documents: { ...s.documents, [id]: { ...s.documents[id], [key]: rows, dirty: true } } })),
  toggleNode: nodeId => set(s => ({ tree: mapTree(s.tree, n => n.id === nodeId && n.type !== 'request' ? { ...n, expanded: !n.expanded } : n) })),
  addNode: (type, parentId) => set(s => {
    const id = `${type}-${Date.now()}`
    if (type === 'request') {
      const requestId = `request-${Date.now()}`
      const doc: RequestDocument = { id: requestId, kind: 'http', name: 'New Request', method: 'GET', url: 'https://', dirty: true,
        params: [{ id: `${id}-p`, enabled: true, key: '', value: '', description: '' }], headers: [{ id: `${id}-h`, enabled: true, key: '', value: '', description: '' }],
        body: { type: 'none', content: '' }, auth: { type: 'none', token: '', username: '', password: '' } }
      return { tree: insertNode(s.tree, parentId, { id, type, requestId, name: doc.name, method: doc.method }), documents: { ...s.documents, [requestId]: doc }, tabs: [...s.tabs, requestId], activeId: requestId, selectedNodeId: id }
    }
    const child: TreeNode = { id, type, name: type === 'collection' ? 'New Collection' : 'New Folder', expanded: true, children: [] }
    return { tree: insertNode(s.tree, parentId, child), selectedNodeId: id }
  }),
  renameNode: (nodeId, name) => set(s => {
    let requestId: string | undefined
    const tree = mapTree(s.tree, n => { if (n.id !== nodeId) return n; if (n.type === 'request') requestId = n.requestId; return { ...n, name } })
    return { tree, documents: requestId ? { ...s.documents, [requestId]: { ...s.documents[requestId], name, dirty: true } } : s.documents }
  }),
  deleteNode: nodeId => set(s => ({ tree: removeNode(s.tree, nodeId), selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId })),
  setRequestPanel: requestPanel => set({ requestPanel }), setResponsePanel: responsePanel => set({ responsePanel }),
  setResponse: (id, response) => set(s => ({ responses: { ...s.responses, [id]: response } })),
}))

export const replaceQuery = (url: string, rows: KeyValueRow[]) => {
  const hashAt = url.indexOf('#'); const hash = hashAt >= 0 ? url.slice(hashAt) : ''; const clean = hashAt >= 0 ? url.slice(0, hashAt) : url
  const base = clean.split('?')[0]
  const query = rows.filter(r => r.enabled && r.key.trim()).map(r => `${encodeURIComponent(r.key)}=${encodeURIComponent(r.value)}`).join('&')
  return `${base}${query ? `?${query}` : ''}${hash}`
}

export const methodOptions: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
