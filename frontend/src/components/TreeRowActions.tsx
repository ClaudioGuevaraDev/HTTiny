import { useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { FilePlus2, FolderPlus, PenLine, Trash2 } from 'lucide-react'
import { useT } from '../language'
import { findNode, requestIdsIn, useAppStore } from '../store'
import type { TreeNode } from '../types'

/**
 * The per-row actions, laid out in the row itself rather than behind a `⋯` popup.
 *
 * Every action used to cost two clicks — open the menu, pick the item — for a set of
 * four that always fits on a 28px row. Dropping the popup also drops everything it
 * needed to be a popup: outside-pointerdown dismissal, `role="menu"`, an open state
 * threaded through the row, and an entrance animation.
 *
 * What it keeps is the delete confirmation and the focus contract, because those were
 * never about the menu.
 *
 * `tabbable` is the difference between the two places this renders. Inside a `treeitem`
 * the buttons must not be tab stops — the tree pattern allows exactly one for the whole
 * tree — so they are reached with Shift+F10 or the ContextMenu key, the same entry point
 * the menu had, and then with ← / →. In the panel heading there is no such rule and no
 * such entry point, so there they are ordinary tab stops.
 */
export function TreeRowActions({
  node,
  tabbable = false,
  onRename,
  onReturnFocus,
}: {
  node: TreeNode
  tabbable?: boolean
  onRename: () => void
  onReturnFocus: () => void
}) {
  const { t, plural } = useT()
  const addNode = useAppStore(s => s.addNode)
  const deleteNode = useAppStore(s => s.deleteNode)
  const groupRef = useRef<HTMLDivElement>(null)

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['Escape', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    // The group renders *inside* the treeitem it belongs to, so every one of these keys
    // also means something to the tree's own handler. Without this the arrow keys would
    // move between buttons and then immediately move tree focus out from under them.
    event.stopPropagation()
    event.preventDefault()

    if (event.key === 'Escape') {
      onReturnFocus()
      return
    }
    const buttons = [...(groupRef.current?.querySelectorAll<HTMLElement>('button') ?? [])]
    const current = buttons.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Home' || event.key === 'End') buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus()
    else buttons[(current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
  }

  // The row's own click opens the request or folds the branch, which is not what
  // pressing one of its buttons means.
  const run = (action: () => void) => (event: ReactMouseEvent) => {
    event.stopPropagation()
    onReturnFocus()
    action()
  }

  const confirmDelete = () => {
    // Deleting a folder prunes every request beneath it — documents, tabs and stored
    // responses — so the confirmation says how much is going, not just the name.
    const target = findNode(useAppStore.getState().tree, node.id)
    const count = target ? requestIdsIn(target).length : 0
    // Whole sentences rather than a clause spliced into one. Spanish puts the count
    // inside an agreeing noun phrase — "y las 3 solicitudes que contiene" — which no
    // amount of concatenation can produce. Zero gets its own message because neither
    // language has a CLDR `zero` category to select.
    const message =
      node.type === 'request'
        ? t('tree.confirm.request', { name: node.name })
        : count === 0
          ? t('tree.confirm.empty', { name: node.name })
          : plural('tree.confirm.container', count, { name: node.name })
    // The OK/Cancel labels come from the OS, not from the app, so the question has to
    // carry the whole meaning and must never name a button.
    if (window.confirm(message)) deleteNode(node.id)
  }

  return (
    <div ref={groupRef} className="tree-actions" role="group" aria-label={t('tree.actions', { name: node.name })} onKeyDown={onKeyDown}>
      {/* Four icons with no text on the same row: each label has to say what it acts on,
          or "New folder" reads as "new folder somewhere". */}
      {node.type !== 'request' && (
        <>
          <button
            type="button"
            className="icon-btn xs"
            tabIndex={tabbable ? undefined : -1}
            aria-label={t('tree.newRequestIn.aria', { name: node.name })}
            title={t('tree.newRequestIn.title', { name: node.name })}
            onClick={run(() => addNode('request', node.id))}
          >
            <FilePlus2 size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn xs"
            tabIndex={tabbable ? undefined : -1}
            aria-label={t('tree.newFolderIn.aria', { name: node.name })}
            title={t('tree.newFolderIn.title', { name: node.name })}
            onClick={run(() => addNode('folder', node.id))}
          >
            <FolderPlus size={13} aria-hidden="true" />
          </button>
        </>
      )}
      {/* Rename is the one action that does not hand focus back to the row: it swaps the
          row's label for an input that focuses itself, and returning focus first would
          race that. */}
      <button
        type="button"
        className="icon-btn xs"
        tabIndex={tabbable ? undefined : -1}
        aria-label={t('tree.rename.aria', { name: node.name })}
        title={t('tree.rename.title', { name: node.name })}
        onClick={event => {
          event.stopPropagation()
          onRename()
        }}
      >
        <PenLine size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="icon-btn xs danger"
        tabIndex={tabbable ? undefined : -1}
        aria-label={t('tree.delete.aria', { name: node.name })}
        title={t('tree.delete.title', { name: node.name })}
        onClick={run(confirmDelete)}
      >
        <Trash2 size={13} aria-hidden="true" />
      </button>
    </div>
  )
}
