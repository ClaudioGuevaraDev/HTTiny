import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { FilePlus2, FolderPlus, MoreHorizontal, PenLine, Trash2 } from 'lucide-react'
import { findNode, requestIdsIn, useAppStore } from '../store'
import type { TreeNode } from '../types'

/**
 * The per-row actions menu, extracted from `Sidebar` because making it a real menu took
 * it from four bare buttons in a `<div>` to something with its own dismissal, focus and
 * keyboard rules.
 *
 * Three things it now does that it did not before: it announces itself (`aria-haspopup`,
 * `aria-expanded`, `role="menu"`), it closes — on Escape, on outside pointer-down, and on
 * every item — returning focus to the row it belongs to, and it confirms deletion.
 *
 * The trigger is `tabIndex={-1}` on purpose. It lives inside a `treeitem`, and the tree
 * pattern allows exactly one tab stop for the whole tree; the menu is reached with
 * Shift+F10 or the ContextMenu key, the same way a file tree behaves everywhere else.
 */
export function TreeRowMenu({
  node,
  open,
  onOpenChange,
  onRename,
  onReturnFocus,
}: {
  node: TreeNode
  open: boolean
  onOpenChange: (open: boolean) => void
  onRename: () => void
  onReturnFocus: () => void
}) {
  const addNode = useAppStore(s => s.addNode)
  const deleteNode = useAppStore(s => s.deleteNode)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const dismiss = () => {
    onOpenChange(false)
    onReturnFocus()
  }

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()

    // `pointerdown` rather than `click`: the menu must be gone before the click lands on
    // whatever is underneath, otherwise the row beneath it also activates.
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onOpenChange(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, onOpenChange])

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) return
    // The menu renders *inside* the treeitem it belongs to, so every one of these keys
    // also means something to the tree's own handler. Without this the arrow keys moved
    // the menu highlight and then immediately moved tree focus out from under it.
    event.stopPropagation()

    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const current = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      dismiss()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      items[(current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
    } else if (event.key === 'Tab') {
      // Same reasoning as the command palette: this is a transient surface, and tabbing
      // out of it would leave it open behind the new focus.
      event.preventDefault()
    }
  }

  const run = (action: () => void) => {
    onOpenChange(false)
    onReturnFocus()
    action()
  }

  const confirmDelete = () => {
    // Deleting a folder prunes every request beneath it — documents, tabs and stored
    // responses — so the confirmation says how much is going, not just the name.
    const target = findNode(useAppStore.getState().tree, node.id)
    const count = target ? requestIdsIn(target).length : 0
    const detail = node.type === 'request' ? '' : count === 1 ? ' and the 1 request inside it' : ` and the ${count} requests inside it`
    if (window.confirm(`Delete “${node.name}”${detail}? This cannot be undone.`)) deleteNode(node.id)
  }

  return (
    <>
      <button
        type="button"
        className="icon-btn xs tree-actions"
        tabIndex={-1}
        aria-label={`Actions for ${node.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={event => {
          event.stopPropagation()
          onOpenChange(!open)
        }}
      >
        <MoreHorizontal size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Actions for ${node.name}`}
          className="tree-menu"
          onClick={event => event.stopPropagation()}
          onKeyDown={onMenuKeyDown}
        >
          {node.type !== 'request' && (
            <>
              <button type="button" role="menuitem" onClick={() => run(() => addNode('request', node.id))}>
                <FilePlus2 size={13} aria-hidden="true" />
                New Request
              </button>
              <button type="button" role="menuitem" onClick={() => run(() => addNode('folder', node.id))}>
                <FolderPlus size={13} aria-hidden="true" />
                New Folder
              </button>
            </>
          )}
          {/* Rename is the one item that does not hand focus back to the row: it swaps the
              row's label for an input that focuses itself, and returning focus first would
              race that. */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenChange(false)
              onRename()
            }}
          >
            <PenLine size={13} aria-hidden="true" />
            Rename
          </button>
          <button type="button" role="menuitem" className="danger" onClick={() => run(confirmDelete)}>
            <Trash2 size={13} aria-hidden="true" />
            Delete
          </button>
        </div>
      )}
    </>
  )
}
