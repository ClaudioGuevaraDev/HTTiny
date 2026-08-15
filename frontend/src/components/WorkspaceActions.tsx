import { Columns2, Command, Rows2, Settings } from 'lucide-react'
import { useT } from '../language'
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
  const { t } = useT()
  const orientation = useAppStore(s => s.splitOrientation)
  const toggleSplitOrientation = useAppStore(s => s.toggleSplitOrientation)
  const openPalette = useAppStore(s => s.openPalette)
  const openSettings = useAppStore(s => s.openSettings)
  const stacked = orientation === 'rows'

  return (
    <div className="workspace-actions">
      <button
        type="button"
        className="icon-btn"
        aria-label={stacked ? t('workspace.sideBySide.aria') : t('workspace.stacked.aria')}
        title={
          stacked
            ? t('workspace.sideBySide.title', { keys: shortcutHint('toggleSplit') })
            : t('workspace.stacked.title', { keys: shortcutHint('toggleSplit') })
        }
        onClick={toggleSplitOrientation}
      >
        {stacked ? <Columns2 size={15} /> : <Rows2 size={15} />}
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={t('workspace.palette.aria')}
        title={t('workspace.palette.title', { keys: shortcutHint('palette') })}
        onClick={() => openPalette('')}
      >
        <Command size={15} />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={t('workspace.settings.aria')}
        title={t('workspace.settings.title', { keys: shortcutHint('settings') })}
        onClick={openSettings}
      >
        <Settings size={15} />
      </button>
    </div>
  )
}
