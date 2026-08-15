import { useEffect, useRef } from 'react'
import { Plus } from 'lucide-react'
import { COLLECTION_PANEL_ID, collectionTabId, hueOf, initialsOf } from '../collections'
import { collectionsIn, useAppStore } from '../store'
import { useRovingFocus } from '../useRovingFocus'

/**
 * The Discord-style collection switcher: one rounded square per collection, and the
 * panel beside it shows only that collection's contents.
 *
 * It sits inside the sidebar rather than being its own grid column, which is what
 * makes the collapsed state fall out for free — collapsing stops rendering the
 * panel and the shell's existing 48px collapsed track is exactly the rail.
 */
export function CollectionRail({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const tree = useAppStore(s => s.tree)
  const activeCollectionId = useAppStore(s => s.activeCollectionId)
  const selectCollection = useAppStore(s => s.selectCollection)
  const addNode = useAppStore(s => s.addNode)
  // The tabs are the only roving group here; the brand mark and the add button sit
  // outside the tablist, because a tablist may own nothing but tabs.
  const onKeyDown = useRovingFocus('[role="tab"]', 'vertical')

  const collections = collectionsIn(tree)
  // The panel falls back to the first collection when nothing is active, and the
  // roving tabindex has to agree with it — otherwise every tab would be -1 and the
  // rail would drop out of the tab order entirely.
  const shown = collections.some(c => c.id === activeCollectionId) ? activeCollectionId : collections[0]?.id

  // Activating a tab switches the collection, and once the strip scrolls that square
  // can be out of view — so the switch would look like nothing happened. Arrow keys
  // get this from the browser's scroll-on-focus; a click on a tab has nothing.
  // `nearest` is a no-op while the square is already visible, so this never steals
  // the scroll position from the user.
  //
  // The braces are load-bearing. As a concise body this returned `scrollIntoView`'s
  // result, which React takes as the cleanup function — and `TypeError: destroy is
  // not a function` during unmount tears down the whole root, leaving a black
  // window. `() => void` accepts any return type, so tsc cannot catch it.
  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [shown])

  return (
    <div className="collection-rail">
      <button
        type="button"
        className="brand-mark"
        aria-label={collapsed ? 'Show collection panel' : 'Hide collection panel'}
        title={collapsed ? 'Show panel' : 'Hide panel'}
        aria-expanded={!collapsed}
        // Only while the panel exists: collapsing unmounts it, and `aria-controls`
        // pointing at an id that is not in the document is worse than omitting it.
        aria-controls={collapsed ? undefined : COLLECTION_PANEL_ID}
        onClick={onToggle}
      >
        H<span>T</span>
      </button>

      <div className="rail-tabs" role="tablist" aria-orientation="vertical" aria-label="Collections" onKeyDown={onKeyDown}>
        {collections.map(collection => {
          const active = collection.id === shown
          return (
            <button
              type="button"
              key={collection.id}
              ref={active ? activeRef : null}
              id={collectionTabId(collection.id)}
              role="tab"
              // The square shows initials, so the accessible name has to carry the
              // real one; `title` gives sighted users the same thing on hover.
              aria-label={collection.name}
              title={collection.name}
              aria-selected={active}
              aria-controls={collapsed ? undefined : COLLECTION_PANEL_ID}
              tabIndex={active ? 0 : -1}
              className="collection-square"
              data-hue={hueOf(collection.id)}
              onClick={() => selectCollection(collection.id)}
            >
              <span aria-hidden="true">{initialsOf(collection.name)}</span>
            </button>
          )
        })}
      </div>

      <button type="button" className="rail-add" aria-label="New collection" title="New collection" onClick={() => addNode('collection')}>
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
