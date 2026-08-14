import { Columns2, Command, Rows2 } from 'lucide-react'
import { shortcutHint } from '../shortcuts'
import { useAppStore } from '../store'

/**
 * Sits at the right end of the existing tab strip. Not a new global bar — that strip
 * already exists and already carries the sidebar toggle on the left.
 *
 * No `aria-pressed`: this is a two-state mode switch whose label changes to describe
 * the result, which reads better than "toggle button, pressed".
 */
export function WorkspaceActions() {
  const orientation = useAppStore(s => s.splitOrientation)
  const toggleSplitOrientation = useAppStore(s => s.toggleSplitOrientation)
  const openPalette = useAppStore(s => s.openPalette)
  const stacked = orientation === 'rows'

  return (
    <div className="workspace-actions">
      <button
        type="button"
        className="icon-btn"
        aria-label={stacked ? 'Switch to side-by-side layout' : 'Switch to stacked layout'}
        title={`${stacked ? 'Side by side' : 'Stacked'} (${shortcutHint('toggleSplit')})`}
        onClick={toggleSplitOrientation}
      >
        {stacked ? <Columns2 size={15} /> : <Rows2 size={15} />}
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Open command palette"
        title={`Search (${shortcutHint('palette')})`}
        onClick={() => openPalette('')}
      >
        <Command size={15} />
      </button>
    </div>
  )
}
