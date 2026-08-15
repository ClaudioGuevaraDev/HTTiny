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

  return (
    <div className="collection-rail">
      <button
        type="button"
        className="brand-mark"
        aria-label={collapsed ? 'Show collection panel' : 'Hide collection panel'}
        title={collapsed ? 'Show panel' : 'Hide panel'}
        aria-expanded={!collapsed}
        aria-controls={COLLECTION_PANEL_ID}
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
              id={collectionTabId(collection.id)}
              role="tab"
              // The square shows initials, so the accessible name has to carry the
              // real one; `title` gives sighted users the same thing on hover.
              aria-label={collection.name}
              title={collection.name}
              aria-selected={active}
              aria-controls={COLLECTION_PANEL_ID}
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
