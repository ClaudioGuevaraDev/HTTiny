import { useMemo, useState } from 'react'
import { Boxes, ChevronDown, ChevronRight, FilePlus2, Folder, FolderPlus, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react'
import { methodColor, type TreeNode } from '../types'
import { useAppStore } from '../store'

function TreeItem({ node, depth, query }: { node: TreeNode; depth: number; query: string }) {
  const { selectedNodeId, openRequest, toggleNode, addNode, renameNode, deleteNode } = useAppStore()
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const children = node.type === 'request' ? [] : node.children
  const matches = !query || node.name.toLowerCase().includes(query)
  const childMatches = node.type !== 'request' && node.children.some(child => child.name.toLowerCase().includes(query))
  if (query && !matches && !childMatches) return null

  const select = () => node.type === 'request' ? openRequest(node.requestId) : toggleNode(node.id)
  return <div className="tree-branch">
    <div className={`tree-row group ${selectedNodeId === node.id ? 'selected' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={select}>
      {node.type !== 'request' ? (node.expanded || query ? <ChevronDown size={13}/> : <ChevronRight size={13}/>) : <span className="w-[13px]"/>}
      {node.type === 'collection' && <Boxes size={14} className="text-zinc-400"/>}
      {node.type === 'folder' && <Folder size={14} className="text-zinc-500"/>}
      {node.type === 'request' && <span className={`method-label ${methodColor[node.method]}`}>{node.method}</span>}
      {renaming ? <input autoFocus className="tree-rename" defaultValue={node.name} onClick={e => e.stopPropagation()} onBlur={e => { renameNode(node.id, e.target.value.trim() || node.name); setRenaming(false) }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(false) }}/>
        : <span className="truncate flex-1">{node.name}</span>}
      <button className="icon-btn xs opacity-0 group-hover:opacity-100" aria-label={`Actions for ${node.name}`} onClick={e => { e.stopPropagation(); setMenu(!menu) }}><MoreHorizontal size={14}/></button>
      {menu && <div className="tree-menu" onClick={e => e.stopPropagation()}>
        {node.type !== 'request' && <>
          <button onClick={() => { addNode('request', node.id); setMenu(false) }}><FilePlus2 size={13}/>New request</button>
          <button onClick={() => { addNode('folder', node.id); setMenu(false) }}><FolderPlus size={13}/>New folder</button>
        </>}
        <button onClick={() => { setRenaming(true); setMenu(false) }}>Rename</button>
        <button className="danger" onClick={() => { deleteNode(node.id); setMenu(false) }}><Trash2 size={13}/>Delete</button>
      </div>}
    </div>
    {node.type !== 'request' && (node.expanded || !!query) && children.map(child => <TreeItem key={child.id} node={child} depth={depth + 1} query={query}/>) }
  </div>
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { tree, addNode } = useAppStore()
  const [query, setQuery] = useState('')
  const normalized = useMemo(() => query.trim().toLowerCase(), [query])
  if (collapsed) return <aside className="sidebar collapsed"><button className="brand-mark" onClick={onToggle} title="Open sidebar">H<span>T</span></button></aside>
  return <aside className="sidebar">
    <header className="app-brand"><button className="brand-mark" onClick={onToggle} title="Collapse sidebar">H<span>T</span></button><div><strong>HTTiny</strong><small>HTTP workspace</small></div><button className="icon-btn ml-auto" title="New collection" onClick={() => addNode('collection')}><Plus size={16}/></button></header>
    <div className="sidebar-section-title"><span>COLLECTIONS</span><div><button className="icon-btn xs" title="New folder" onClick={() => addNode('folder', 'main')}><FolderPlus size={14}/></button><button className="icon-btn xs" title="New request" onClick={() => addNode('request', 'main')}><FilePlus2 size={14}/></button></div></div>
    <label className="search-box"><Search size={14}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter requests"/></label>
    <div className="tree-scroll">{tree.map(node => <TreeItem key={node.id} node={node} depth={0} query={normalized}/>)}</div>
    <footer className="sidebar-footer"><span className="status-dot"/>Mock workspace <span className="ml-auto">v0.1</span></footer>
  </aside>
}
