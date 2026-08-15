import { useState } from 'react'
import { Boxes, ChevronDown, ChevronRight, FilePlus2, Folder, FolderPlus, Plus, Search } from 'lucide-react'
import type { VisibleRow } from '../store'
import { useAppStore } from '../store'
import { useTreeNavigation } from '../useTreeNavigation'
import { shortcuts } from '../shortcuts'
import { MethodChip } from './MethodChip'
import { Placeholder, PlaceholderAction, Shortcut } from './Placeholder'
import { TreeRowMenu } from './TreeRowMenu'

/**
 * The footer used to read "Mock responses", which was true and is not any more.
 * It now carries the one fact the user cannot otherwise check: whether their work
 * is actually on disk. The failure states are the point — a silent autosave that
 * has stopped working is worse than no autosave at all.
 */
function SaveStatus() {
  const persistenceState = useAppStore(s => s.persistenceState)
  const saveState = useAppStore(s => s.saveState)
  const secretsAvailable = useAppStore(s => s.secretsAvailable)
  const dataDir = useAppStore(s => s.dataDir)

  const [tone, label] =
    persistenceState === 'unavailable'
      ? (['warn', 'Not saved — browser preview'] as const)
      : persistenceState === 'newer-version'
        ? (['error', 'Newer workspace — not saving'] as const)
        : saveState === 'error'
          ? (['error', 'Save failed'] as const)
          : saveState === 'saving' || saveState === 'pending'
            ? (['pending', 'Saving…'] as const)
            : !secretsAvailable
              ? (['warn', 'Saved · no keychain'] as const)
              : (['ok', 'Saved'] as const)

  return (
    <footer className="sidebar-footer" data-tone={tone} title={dataDir || undefined}>
      <span className="status-dot" aria-hidden="true" />
      {label}
      <span className="ml-auto">v{__APP_VERSION__}</span>
    </footer>
  )
}

function TreeRow({ row, active, onFocusRow }: { row: VisibleRow; active: boolean; onFocusRow: (id: string) => void }) {
  const { node, depth, position, siblings } = row
  const selectedNodeId = useAppStore(s => s.selectedNodeId)
  const openRequest = useAppStore(s => s.openRequest)
  const toggleNode = useAppStore(s => s.toggleNode)
  const renameNode = useAppStore(s => s.renameNode)
  // Read the method from the document rather than the node. `RequestNode.method`
  // used to be a denormalised copy that nothing kept in sync, so changing the method
  // in the editor left the tree showing the old one.
  const method = useAppStore(s => (node.type === 'request' ? s.documents[node.requestId]?.method : undefined))
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const selected = selectedNodeId === node.id

  const select = () => (node.type === 'request' ? openRequest(node.requestId) : toggleNode(node.id))

  return (
    <div
      className={`tree-row group ${selected ? 'selected' : ''}`}
      role="treeitem"
      data-node-id={node.id}
      tabIndex={active ? 0 : -1}
      aria-level={depth + 1}
      aria-posinset={position}
      aria-setsize={siblings}
      aria-selected={selected}
      aria-expanded={node.type !== 'request' ? node.expanded : undefined}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => {
        onFocusRow(node.id)
        select()
      }}
      // Shift+F10 and the ContextMenu key are the standard way to reach a row's actions
      // from the keyboard, since the trigger itself is deliberately not a tab stop.
      onKeyDown={event => {
        if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
          event.preventDefault()
          setMenu(true)
        }
      }}
    >
      {node.type !== 'request' ? (
        node.expanded ? (
          <ChevronDown size={13} aria-hidden="true" />
        ) : (
          <ChevronRight size={13} aria-hidden="true" />
        )
      ) : (
        <span className="w-[13px]" />
      )}
      {node.type === 'collection' && <Boxes size={14} className="tree-icon" aria-hidden="true" />}
      {node.type === 'folder' && <Folder size={14} className="tree-icon" aria-hidden="true" />}
      {node.type === 'request' && method && <MethodChip method={method} variant="chip" />}
      {renaming ? (
        /* `autoFocus` is justified here — a single input that appears on demand, on
           desktop, in direct response to choosing Rename. */
        <input
          autoFocus
          className="tree-rename"
          aria-label={`Rename ${node.name}`}
          defaultValue={node.name}
          autoComplete="off"
          spellCheck={false}
          onClick={e => e.stopPropagation()}
          onBlur={e => {
            renameNode(node.id, e.target.value.trim() || node.name)
            setRenaming(false)
            onFocusRow(node.id)
          }}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setRenaming(false)
              onFocusRow(node.id)
            }
          }}
        />
      ) : (
        <span className="truncate flex-1">{node.name}</span>
      )}
      <TreeRowMenu node={node} open={menu} onOpenChange={setMenu} onRename={() => setRenaming(true)} onReturnFocus={() => onFocusRow(node.id)} />
    </div>
  )
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const addNode = useAppStore(s => s.addNode)
  const openPalette = useAppStore(s => s.openPalette)
  const { containerRef, rows, activeId, onKeyDown, focusRow } = useTreeNavigation()

  if (collapsed)
    return (
      <nav className="sidebar collapsed" id="sidebar" aria-label="Collections">
        <h1 className="sr-only">HTTiny</h1>
        <button className="brand-mark" aria-label="Show sidebar" title="Show sidebar" onClick={onToggle}>
          H<span>T</span>
        </button>
      </nav>
    )

  return (
    <nav className="sidebar" id="sidebar" aria-label="Collections">
      <header className="app-brand">
        <button className="brand-mark" aria-label="Collapse sidebar" title="Collapse sidebar" onClick={onToggle}>
          H<span>T</span>
        </button>
        <div>
          <h1>HTTiny</h1>
          <small>HTTP workspace</small>
        </div>
        <button className="icon-btn ml-auto" aria-label="New collection" title="New collection" onClick={() => addNode('collection')}>
          <Plus size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="sidebar-section-title">
        <span id="collections-label">COLLECTIONS</span>
        <div>
          <button className="icon-btn xs" aria-label="New folder" title="New folder" onClick={() => addNode('folder')}>
            <FolderPlus size={14} aria-hidden="true" />
          </button>
          <button className="icon-btn xs" aria-label="New request" title="New request" onClick={() => addNode('request')}>
            <FilePlus2 size={14} aria-hidden="true" />
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
      {rows.length === 0 ? (
        /* Deleting the last collection used to leave a blank panel with no way back
           except the header's `+`. */
        <div className="tree-scroll">
          {/* This is both the "you deleted everything" state and the very first thing
              a new user sees, so it leads with the request — the thing the app is for —
              and offers the collection as the way to organise them afterwards. */}
          <Placeholder icon={<Boxes size={20} />} title="No requests yet" description="Create a request to send your first call, or start with a collection.">
            <PlaceholderAction shortcut={shortcuts.newRequest} onClick={() => addNode('request')}>
              New request
            </PlaceholderAction>
            <PlaceholderAction variant="secondary" onClick={() => addNode('collection')}>
              New collection
            </PlaceholderAction>
          </Placeholder>
        </div>
      ) : (
        <div className="tree-scroll" ref={containerRef} role="tree" aria-labelledby="collections-label" onKeyDown={onKeyDown}>
          {rows.map(row => (
            <TreeRow key={row.node.id} row={row} active={row.node.id === activeId} onFocusRow={focusRow} />
          ))}
        </div>
      )}
      <SaveStatus />
    </nav>
  )
}
