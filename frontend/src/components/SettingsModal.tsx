import { useEffect, useRef, useState } from 'react'
import { HardDrive, Monitor, Moon, Settings2, Sun, X } from 'lucide-react'
import type { MessageKey } from '../i18n'
import { useT } from '../language'
import { useSystemTheme } from '../theme'
import type { Locale, ThemePreference } from '../types'
import { useAppStore } from '../store'
import { useRovingFocus } from '../useRovingFocus'
import { Placeholder } from './Placeholder'

type Section = 'general' | 'storage'

const SECTIONS = [
  { id: 'general', label: 'settings.section.general', icon: Settings2 },
  { id: 'storage', label: 'settings.section.storage', icon: HardDrive },
] as const satisfies readonly { id: Section; label: MessageKey; icon: typeof Settings2 }[]

const THEMES = [
  { id: 'system', label: 'settings.theme.system', icon: Monitor },
  { id: 'light', label: 'settings.theme.light', icon: Sun },
  { id: 'dark', label: 'settings.theme.dark', icon: Moon },
] as const satisfies readonly { id: ThemePreference; label: MessageKey; icon: typeof Sun }[]

/**
 * The in-sentence forms, which are not the button labels: Spanish lower-cases a theme
 * name mid-sentence, and the previous version spliced the raw `'light'` / `'dark'`
 * token into the copy, which would have read "Siempre dark".
 */
const THEME_INLINE = {
  light: 'settings.theme.inline.light',
  dark: 'settings.theme.inline.dark',
} as const satisfies Record<'light' | 'dark', MessageKey>

/**
 * Endonyms, and the one set of labels in the app that is deliberately identical in
 * every locale: someone who cannot read the current interface has to be able to find
 * their own language in this list. No flags either — a flag is a country, and Español
 * is not Spain.
 */
const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
] as const satisfies readonly { id: Locale; label: string }[]

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
  const { t } = useT()
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
          {t('settings.title')}
        </h2>
        <div className="settings-sections" role="tablist" aria-orientation="vertical" aria-label={t('settings.sections')} onKeyDown={onNavKeyDown}>
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
              {t(label)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-panel" role="tabpanel" id={panelId(section)} aria-labelledby={tabId(section)} tabIndex={-1}>
        {section === 'general' ? (
          <GeneralSection />
        ) : (
          <Placeholder icon={<HardDrive size={20} />} title={t('settings.storage.title')} description={t('settings.storage.desc')} />
        )}
      </div>

      {/* The dialog can already be dismissed with Escape and by clicking outside, but
          neither is visible, and this is the only control in the modal that is not a
          setting. */}
      <button type="button" className="icon-btn settings-close" aria-label={t('settings.close')} onClick={onDismiss}>
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * Two groups rather than one: "Appearance" promises how the app *looks*, and the
 * language changes what it *says*. Someone scanning for the language control should
 * not have to read past a heading that does not promise it.
 */
function GeneralSection() {
  const { t } = useT()

  return (
    <>
      <h3 className="settings-heading">{t('settings.appearance')}</h3>
      <ThemeRow />
      <h3 className="settings-heading">{t('settings.language.heading')}</h3>
      <LanguageRow />
    </>
  )
}

function ThemeRow() {
  const { t } = useT()
  const theme = useAppStore(s => s.theme)
  const setTheme = useAppStore(s => s.setTheme)
  const system = useSystemTheme()
  // A radiogroup, not a tablist: these pick a value, they do not switch panels.
  const onThemeKeyDown = useRovingFocus('[role="radio"]')

  return (
    <div className="settings-row">
      <div className="settings-label">
        {/* A span rather than a label: there is no single control to point at, and
            the radiogroup takes its name from here through `aria-labelledby`. */}
        <span id="settings-theme-label">{t('settings.theme.label')}</span>
        {/* "System" on its own says nothing about what is on screen. */}
        <p>
          {theme === 'system'
            ? t('settings.theme.desc.system', { theme: t(THEME_INLINE[system]) })
            : t('settings.theme.desc.always', { theme: t(THEME_INLINE[theme]) })}
        </p>
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
            {t(label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * No `System` option, unlike the theme.
 *
 * `prefers-color-scheme` is published by the OS and can flip under a running window, so
 * following it is a live behaviour worth offering. A webview's `navigator.language`
 * only changes on restart, and picking an interface language is a deliberate act — so
 * the app opens in English and remembers whatever is chosen here.
 */
function LanguageRow() {
  const { t } = useT()
  const language = useAppStore(s => s.language)
  const setLanguage = useAppStore(s => s.setLanguage)
  const onLanguageKeyDown = useRovingFocus('[role="radio"]')

  return (
    <div className="settings-row">
      <div className="settings-label">
        <span id="settings-language-label">{t('settings.language.label')}</span>
        <p>{t('settings.language.desc')}</p>
      </div>
      <div className="segmented" role="radiogroup" aria-labelledby="settings-language-label" onKeyDown={onLanguageKeyDown}>
        {LANGUAGES.map(({ id, label }) => (
          <button
            type="button"
            key={id}
            role="radio"
            aria-checked={language === id}
            tabIndex={language === id ? 0 : -1}
            className={language === id ? 'active' : ''}
            onClick={() => setLanguage(id)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
