import { useEffect, useRef, useState } from 'react'
import { HardDrive, Monitor, Moon, Settings2, Sun, X } from 'lucide-react'
import { useSystemTheme } from '../theme'
import type { ThemePreference } from '../types'
import { useAppStore } from '../store'
import { useRovingFocus } from '../useRovingFocus'
import { Placeholder } from './Placeholder'

type Section = 'general' | 'storage'

const SECTIONS = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'storage', label: 'Storage', icon: HardDrive },
] as const satisfies readonly { id: Section; label: string; icon: typeof Settings2 }[]

const THEMES = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
] as const satisfies readonly { id: ThemePreference; label: string; icon: typeof Sun }[]

const panelId = (section: Section) => `settings-panel-${section}`
const tabId = (section: Section) => `settings-tab-${section}`

/**
 * Same shell as the command palette, and for the same four reasons: `<dialog>` with
 * `showModal()` supplies a real focus trap, top-layer rendering, focus restoration on
 * close and native Escape. The body only mounts while open, and closing always goes
 * through `dialog.close()` so the DOM and the store cannot desync.
 */
export function SettingsModal() {
  const open = useAppStore(s => s.settingsOpen)
  const closeSettings = useAppStore(s => s.closeSettings)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClose={closeSettings}
      onClick={event => {
        if (event.target === dialogRef.current) dialogRef.current?.close()
      }}
    >
      {open && <SettingsBody onDismiss={() => dialogRef.current?.close()} />}
    </dialog>
  )
}

function SettingsBody({ onDismiss }: { onDismiss: () => void }) {
  const [section, setSection] = useState<Section>('general')
  // Vertical, unlike every other tablist in the app: the sections are a column, and
  // the ARIA pattern says the arrow keys have to follow the layout, not the role.
  const onNavKeyDown = useRovingFocus('[role="tab"]', 'vertical')

  return (
    <div className="settings-shell">
      {/* The heading sits beside the tablist, not inside it: a tablist's children are
          tabs, and a screen reader walking one should not find a heading in there. */}
      <div className="settings-nav">
        <h2 id="settings-title" className="settings-title">
          Settings
        </h2>
        <div className="settings-sections" role="tablist" aria-orientation="vertical" aria-label="Settings sections" onKeyDown={onNavKeyDown}>
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              role="tab"
              id={tabId(id)}
              aria-selected={section === id}
              aria-controls={panelId(id)}
              tabIndex={section === id ? 0 : -1}
              className={section === id ? 'active' : ''}
              onClick={() => setSection(id)}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-panel" role="tabpanel" id={panelId(section)} aria-labelledby={tabId(section)} tabIndex={-1}>
        {section === 'general' ? (
          <GeneralSection />
        ) : (
          <Placeholder icon={<HardDrive size={20} />} title="Nothing here yet" description="Storage settings will live in this panel." />
        )}
      </div>

      {/* The dialog can already be dismissed with Escape and by clicking outside, but
          neither is visible, and this is the only control in the modal that is not a
          setting. */}
      <button type="button" className="icon-btn settings-close" aria-label="Close settings" onClick={onDismiss}>
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  )
}

function GeneralSection() {
  const theme = useAppStore(s => s.theme)
  const setTheme = useAppStore(s => s.setTheme)
  const system = useSystemTheme()
  // A radiogroup, not a tablist: these pick a value, they do not switch panels.
  const onThemeKeyDown = useRovingFocus('[role="radio"]')

  return (
    <>
      <h3 className="settings-heading">Appearance</h3>
      <div className="settings-row">
        <div className="settings-label">
          {/* A span rather than a label: there is no single control to point at, and
              the radiogroup takes its name from here through `aria-labelledby`. */}
          <span id="settings-theme-label">Theme</span>
          {/* "System" on its own says nothing about what is on screen. */}
          <p>{theme === 'system' ? `Following the system, currently ${system}.` : `Always ${theme}, whatever the system is set to.`}</p>
        </div>
        <div className="segmented" role="radiogroup" aria-labelledby="settings-theme-label" onKeyDown={onThemeKeyDown}>
          {THEMES.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              role="radio"
              aria-checked={theme === id}
              tabIndex={theme === id ? 0 : -1}
              className={theme === id ? 'active' : ''}
              onClick={() => setTheme(id)}
            >
              <Icon size={13} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
