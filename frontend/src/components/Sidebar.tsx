import { useMemo, useState } from 'react'
import { Boxes, ChevronDown, ChevronRight, FilePlus2, Folder, FolderPlus, Search } from 'lucide-react'
import type { VisibleRow } from '../store'
import { collectionsIn, useAppStore } from '../store'
import type { CollectionNode } from '../types'
import { useTreeNavigation } from '../useTreeNavigation'
import { shortcuts } from '../shortcuts'
import { COLLECTION_PANEL_ID, collectionTabId } from '../collections'
import { CollectionRail } from './CollectionRail'
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

/**
 * The active collection's name, doubling as the tree's accessible name and as the
 * home for the collection's own actions.
 *
 * Those actions need a home because the collection is no longer a row in the tree —
 * the rail replaced it — so `TreeRowMenu` is reused here against the collection
 * node. It already offers exactly New Request / New Folder / Rename / Delete for
 * branch nodes, and the inline rename mirrors what `TreeRow` does.
 */
function CollectionHeading({ collection }: { collection: CollectionNode }) {
  const addNode = useAppStore(s => s.addNode)
  const renameNode = useAppStore(s => s.renameNode)
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)

  return (
    <div className="sidebar-section-title">
      {renaming ? (
        <input
          autoFocus
          className="tree-rename"
          aria-label={`Rename ${collection.name}`}
          defaultValue={collection.name}
          autoComplete="off"
          spellCheck={false}
          onBlur={e => {
            renameNode(collection.id, e.target.value.trim() || collection.name)
            setRenaming(false)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setRenaming(false)
          }}
        />
      ) : (
        <span id="collections-label" className="truncate">
          {collection.name}
        </span>
      )}
      <div>
        <button className="icon-btn xs" aria-label="New folder" title="New folder" onClick={() => addNode('folder')}>
          <FolderPlus size={14} aria-hidden="true" />
        </button>
        <button className="icon-btn xs" aria-label="New request" title="New request" onClick={() => addNode('request')}>
          <FilePlus2 size={14} aria-hidden="true" />
        </button>
        <TreeRowMenu node={collection} open={menu} onOpenChange={setMenu} onRename={() => setRenaming(true)} onReturnFocus={() => undefined} />
      </div>
    </div>
  )
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const addNode = useAppStore(s => s.addNode)
  const openPalette = useAppStore(s => s.openPalette)
  const tree = useAppStore(s => s.tree)
  const activeCollectionId = useAppStore(s => s.activeCollectionId)
  const { containerRef, rows, activeId, onKeyDown, focusRow } = useTreeNavigation()

  // Derived from `tree` rather than selected as `s => collectionsIn(s.tree)`: that
  // selector would build a new array on every store change, and zustand compares
  // with Object.is, so the whole sidebar would re-render on every keystroke.
  const collections = useMemo(() => collectionsIn(tree), [tree])
  const collection = collections.find(c => c.id === activeCollectionId) ?? collections[0]

  return (
    /* One `<nav>` holding both the rail and the panel, so the landmark, the id and
       the `aria-controls` on the workspace toggle all keep pointing at a live
       element whether or not the panel is showing. */
    <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`} id="sidebar" aria-label="Collections">
      <h1 className="sr-only">HTTiny</h1>
      <CollectionRail collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && (
        <div
          className="sidebar-panel"
          id={COLLECTION_PANEL_ID}
          role={collection ? 'tabpanel' : undefined}
          aria-labelledby={collection ? collectionTabId(collection.id) : undefined}
        >
          {collection && <CollectionHeading collection={collection} />}
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
          {/* Two empty states, not one: with the tree scoped to a collection, "no
              rows" no longer means "nothing exists" — it usually means this
              collection is empty, which needs a different way out. */}
          {!collection ? (
            <div className="tree-scroll">
              <Placeholder icon={<Boxes size={20} />} title="No collections yet" description="Collections group your requests. Create one to get started.">
                <PlaceholderAction onClick={() => addNode('collection')}>New collection</PlaceholderAction>
              </Placeholder>
            </div>
          ) : rows.length === 0 ? (
            <div className="tree-scroll">
              <Placeholder icon={<Boxes size={20} />} title="Nothing here yet" description={`“${collection.name}” has no requests. Add one to send your first call.`}>
                <PlaceholderAction shortcut={shortcuts.newRequest} onClick={() => addNode('request')}>
                  New request
                </PlaceholderAction>
                <PlaceholderAction variant="secondary" onClick={() => addNode('folder')}>
                  New folder
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
        </div>
      )}
    </nav>
  )
}
