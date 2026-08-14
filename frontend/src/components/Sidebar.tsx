import { useState } from 'react'
import { Boxes, ChevronDown, ChevronRight, FilePlus2, Folder, FolderPlus, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react'
import type { TreeNode } from '../types'
import { useAppStore } from '../store'
import { shortcuts } from '../shortcuts'
import { MethodChip } from './MethodChip'
import { Shortcut } from './Placeholder'

function TreeItem({ node, depth }: { node: TreeNode; depth: number }) {
  const selectedNodeId = useAppStore(s => s.selectedNodeId)
  const openRequest = useAppStore(s => s.openRequest)
  const toggleNode = useAppStore(s => s.toggleNode)
  const addNode = useAppStore(s => s.addNode)
  const renameNode = useAppStore(s => s.renameNode)
  const deleteNode = useAppStore(s => s.deleteNode)
  // Read the method from the document rather than the node. `RequestNode.method`
  // used to be a denormalised copy that nothing kept in sync, so changing the method
  // in the editor left the tree showing the old one.
  const method = useAppStore(s => (node.type === 'request' ? s.documents[node.requestId]?.method : undefined))
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const children = node.type === 'request' ? [] : node.children

  const select = () => (node.type === 'request' ? openRequest(node.requestId) : toggleNode(node.id))

  return (
    <div className="tree-branch">
      <div className={`tree-row group ${selectedNodeId === node.id ? 'selected' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={select}>
        {node.type !== 'request' ? node.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className="w-[13px]" />}
        {node.type === 'collection' && <Boxes size={14} className="tree-icon" />}
        {node.type === 'folder' && <Folder size={14} className="tree-icon" />}
        {node.type === 'request' && method && <MethodChip method={method} variant="chip" />}
        {renaming ? (
          <input
            autoFocus
            className="tree-rename"
            defaultValue={node.name}
            onClick={e => e.stopPropagation()}
            onBlur={e => {
              renameNode(node.id, e.target.value.trim() || node.name)
              setRenaming(false)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <span className="truncate flex-1">{node.name}</span>
        )}
        <button
          className="icon-btn xs opacity-0 group-hover:opacity-100"
          aria-label={`Actions for ${node.name}`}
          onClick={e => {
            e.stopPropagation()
            setMenu(!menu)
          }}
        >
          <MoreHorizontal size={14} />
        </button>
        {menu && (
          <div className="tree-menu" onClick={e => e.stopPropagation()}>
            {node.type !== 'request' && (
              <>
                <button
                  onClick={() => {
                    addNode('request', node.id)
                    setMenu(false)
                  }}
                >
                  <FilePlus2 size={13} />
                  New request
                </button>
                <button
                  onClick={() => {
                    addNode('folder', node.id)
                    setMenu(false)
                  }}
                >
                  <FolderPlus size={13} />
                  New folder
                </button>
              </>
            )}
            <button
              onClick={() => {
                setRenaming(true)
                setMenu(false)
              }}
            >
              Rename
            </button>
            <button
              className="danger"
              onClick={() => {
                deleteNode(node.id)
                setMenu(false)
              }}
            >
              <Trash2 size={13} />
              Delete
            </button>
          </div>
        )}
      </div>
      {node.type !== 'request' && node.expanded && children.map(child => <TreeItem key={child.id} node={child} depth={depth + 1} />)}
    </div>
  )
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const tree = useAppStore(s => s.tree)
  const addNode = useAppStore(s => s.addNode)
  const openPalette = useAppStore(s => s.openPalette)

  if (collapsed)
    return (
      <aside className="sidebar collapsed">
        <button className="brand-mark" onClick={onToggle} title="Open sidebar">
          H<span>T</span>
        </button>
      </aside>
    )

  return (
    <aside className="sidebar">
      <header className="app-brand">
        <button className="brand-mark" onClick={onToggle} title="Collapse sidebar">
          H<span>T</span>
        </button>
        <div>
          <strong>HTTiny</strong>
          <small>HTTP workspace</small>
        </div>
        <button className="icon-btn ml-auto" title="New collection" onClick={() => addNode('collection')}>
          <Plus size={16} />
        </button>
      </header>
      <div className="sidebar-section-title">
        <span>COLLECTIONS</span>
        <div>
          <button className="icon-btn xs" title="New folder" onClick={() => addNode('folder', 'main')}>
            <FolderPlus size={14} />
          </button>
          <button className="icon-btn xs" title="New request" onClick={() => addNode('request', 'main')}>
            <FilePlus2 size={14} />
          </button>
        </div>
      </div>
      {/*
        This was an in-tree filter, but it only ever matched direct children, so
        searching for a request nested two levels deep emptied the entire tree. It
        now opens the command palette, which searches every request by name, method
        and URL, and reveals the match in place instead of collapsing everything
        around it.
      */}
      <button type="button" className="search-trigger" onClick={() => openPalette('')}>
        <Search size={13} aria-hidden="true" />
        <span>Search requests</span>
        <Shortcut keys={shortcuts.palette} />
      </button>
      <div className="tree-scroll">
        {tree.map(node => (
          <TreeItem key={node.id} node={node} depth={0} />
        ))}
      </div>
      <footer className="sidebar-footer">
        <span className="status-dot" />
        Mock responses <span className="ml-auto">v{__APP_VERSION__}</span>
      </footer>
    </aside>
  )
}
