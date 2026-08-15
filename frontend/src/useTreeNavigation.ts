import { useCallback, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { collectionsIn, flattenVisible, useAppStore } from './store'

/**
 * Keyboard operation for the sidebar tree, per the WAI-ARIA tree pattern.
 *
 * The rows used to be `<div onClick>` with no role, no tabindex and no key handler:
 * the entire collection hierarchy — the app's primary navigation — was unreachable
 * without a mouse, a straight WCAG 2.1.1 failure.
 *
 * The tree is one tab stop. `focusedId` is the roving tabindex: exactly one row carries
 * `tabIndex={0}` and the rest `-1`, so Tab enters the tree once and the arrow keys move
 * within it. Focus is applied through a DOM effect rather than `autoFocus`, because the
 * row that should receive it may have just been revealed by expanding its parent.
 */
export function useTreeNavigation() {
  const tree = useAppStore(s => s.tree)
  const activeCollectionId = useAppStore(s => s.activeCollectionId)
  const selectedNodeId = useAppStore(s => s.selectedNodeId)
  const openRequest = useAppStore(s => s.openRequest)
  const toggleNode = useAppStore(s => s.toggleNode)

  // Scoped to the active collection's children, which is the whole of the rail's
  // effect on the tree: depth, `aria-level`, posinset/setsize, the roving stop and
  // the empty state all recompute from this one substitution. The collection itself
  // is not a row — its name is the panel heading, the way Discord does not list the
  // server among its channels.
  const rows = useMemo(() => {
    const collections = collectionsIn(tree)
    const active = collections.find(c => c.id === activeCollectionId) ?? collections[0]
    return flattenVisible(active?.children ?? [])
  }, [tree, activeCollectionId])
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // The roving stop defaults to the selected row, then to the first row. Reading it
  // during render rather than syncing it into state keeps the two from disagreeing when
  // the focused node is deleted out from under us.
  const active = rows.some(r => r.node.id === focusedId) ? focusedId : (rows.find(r => r.node.id === selectedNodeId)?.node.id ?? rows[0]?.node.id ?? null)

  // Focus moves synchronously rather than through an effect. Every target is already on
  // screen when `moveTo` runs — `←`/`→` only step between rows that are visible, and
  // expanding a branch does not move focus — so there is nothing to wait for, and an
  // effect keyed on the focused id would re-steal focus on unrelated re-renders.
  // `tabIndex` catching up a render later is harmless: programmatic focus works on -1.
  const moveTo = useCallback((id: string | undefined) => {
    if (!id) return
    setFocusedId(id)
    containerRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)?.focus()
  }, [])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      // The rename input and the row menu both live inside a row, and both want keys the
      // tree also claims. They stop propagation themselves; this is the belt to that
      // braces, so a new in-row control cannot silently hand Enter to the tree.
      if (event.target instanceof HTMLElement && event.target.closest('input, [role="menu"]')) return

      const index = rows.findIndex(r => r.node.id === active)
      if (index === -1) return
      const { node, parentId } = rows[index]
      const branch = node.type !== 'request' ? node : null

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          moveTo(rows[index + 1]?.node.id)
          break
        case 'ArrowUp':
          event.preventDefault()
          moveTo(rows[index - 1]?.node.id)
          break
        case 'ArrowRight':
          event.preventDefault()
          // Collapsed branch: open it. Already open: step onto the first child, which
          // is the next visible row by construction.
          if (branch && !branch.expanded) toggleNode(branch.id)
          else if (branch?.children.length) moveTo(rows[index + 1]?.node.id)
          break
        case 'ArrowLeft':
          event.preventDefault()
          if (branch?.expanded) toggleNode(branch.id)
          else if (parentId) moveTo(parentId)
          break
        case 'Home':
          event.preventDefault()
          moveTo(rows[0]?.node.id)
          break
        case 'End':
          event.preventDefault()
          moveTo(rows[rows.length - 1]?.node.id)
          break
        case 'Enter':
        case ' ':
          event.preventDefault()
          if (node.type === 'request') openRequest(node.requestId)
          else toggleNode(node.id)
          break
        default:
          break
      }
    },
    [rows, active, moveTo, openRequest, toggleNode],
  )

  return { containerRef, rows, activeId: active, onKeyDown, focusRow: moveTo }
}
