import { useEffect, useRef, useState } from 'react'
import { HardDrive, Settings2, X } from 'lucide-react'
import type { MessageKey, PlainMessageKey } from '../i18n'
import { useT } from '../language'
import { useSystemTheme } from '../theme'
import type { Locale, ThemePreference } from '../types'
import { SIDEBAR_WIDTH, SPLIT_RATIO, useAppStore } from '../store'
import { useRovingFocus } from '../useRovingFocus'
import { Placeholder } from './Placeholder'

type Section = 'general' | 'storage'

const SECTIONS = [
  { id: 'general', label: 'settings.section.general', icon: Settings2 },
  { id: 'storage', label: 'settings.section.storage', icon: HardDrive },
] as const satisfies readonly { id: Section; label: MessageKey; icon: typeof Settings2 }[]

/**
 * No icons: an `<option>` is drawn by the OS and cannot carry one. Nothing is lost that
 * the words were not already carrying — "System" / "Light" / "Dark" name the choice
 * without leaning on a glyph.
 */
const THEMES = [
  { id: 'system', label: 'settings.theme.system' },
  { id: 'light', label: 'settings.theme.light' },
  { id: 'dark', label: 'settings.theme.dark' },
] as const satisfies readonly { id: ThemePreference; label: MessageKey }[]

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
 * Three groups rather than one: "Appearance" and "Layout" both promise how the app
 * *looks* — so they sit together — while the language changes what it *says*. Someone
 * scanning for the language control should not have to read past a heading that does
 * not promise it.
 */
function GeneralSection() {
  const { t } = useT()

  return (
    <>
      <h3 className="settings-heading">{t('settings.appearance')}</h3>
      <ThemeRow />
      <h3 className="settings-heading">{t('settings.layout.heading')}</h3>
      <SidebarWidthRow />
      <SplitRatioRow />
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

  return (
    <div className="settings-row">
      <div className="settings-label">
        {/* A real label, now that there is a single control to point at — which also
            makes the text clickable to focus the select. It used to be a span because
            a radiogroup can only be named through `aria-labelledby`. */}
        <label htmlFor="settings-theme">{t('settings.theme.label')}</label>
        {/* "System" on its own says nothing about what is on screen. */}
        <p id="settings-theme-desc">
          {theme === 'system'
            ? t('settings.theme.desc.system', { theme: t(THEME_INLINE[system]) })
            : t('settings.theme.desc.always', { theme: t(THEME_INLINE[theme]) })}
        </p>
      </div>
      <select
        id="settings-theme"
        className="settings-select"
        aria-describedby="settings-theme-desc"
        value={theme}
        onChange={event => {
          // `find` over the source of truth instead of asserting what came out of the
          // DOM, the same way the response body's language picker does it: the option
          // list and the union cannot drift apart, and nothing needs `as`.
          const next = THEMES.find(option => option.id === event.target.value)
          if (next) setTheme(next.id)
        }}
      >
        {THEMES.map(({ id, label }) => (
          <option key={id} value={id}>
            {t(label)}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * The shared shape behind both layout rows.
 *
 * Native rather than reimplemented, for the same reasons as the `<select>` above: the
 * platform draws a slider that already follows the theme through `accent-color`, and it
 * supplies the arrow keys, Home/End and Page keys for nothing. `SplitHandle` had to
 * hand-roll all of that because a resizer is a `role="separator"` on a 4px track, which
 * has no native equivalent.
 *
 * The description and the readout arrive already translated, which is what lets `label`
 * be a `PlainMessageKey` — a key carried as a value would otherwise widen to the whole
 * union and make `t()` demand every param any message might want.
 */
function RangeRow({
  id,
  label,
  description,
  valueText,
  value,
  min,
  max,
  onChange,
}: {
  id: string
  label: PlainMessageKey
  description: string
  valueText: string
  value: number
  min: number
  max: number
  onChange: (next: number) => void
}) {
  const { t } = useT()

  return (
    <div className="settings-row">
      <div className="settings-label">
        <label htmlFor={id}>{t(label)}</label>
        <p id={`${id}-desc`}>{description}</p>
      </div>
      <div className="settings-range">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          // Deliberately not the `step={16}` / `step={4}` the drag handles use for their
          // keyboard increments: a range input snaps its value to the nearest multiple of
          // `step`, so a coarse step would move the thumb off the value actually in the
          // store — 330 is not `268 + 16n`. Step 1 keeps the thumb honest and gives the
          // fine adjustment the handles cannot.
          step={1}
          value={value}
          aria-describedby={`${id}-desc`}
          // Without this a screen reader announces a bare "52", which says neither the
          // unit nor which pane gets it.
          aria-valuetext={valueText}
          // `valueAsNumber`, not `Number(event.target.value)`: a range always yields a
          // finite number, which sidesteps the `NaN` hole in `setSidebarWidth` /
          // `setSplitRatio` — they clamp with `Math.min`/`Math.max`, which propagate it.
          onChange={event => onChange(event.target.valueAsNumber)}
        />
        <output htmlFor={id} className="settings-range-value">
          {valueText}
        </output>
      </div>
    </div>
  )
}

function SidebarWidthRow() {
  const { t } = useT()
  const width = useAppStore(s => s.sidebarWidth)
  const collapsed = useAppStore(s => s.sidebarCollapsed)
  const setSidebarWidth = useAppStore(s => s.setSidebarWidth)

  return (
    <RangeRow
      id="settings-sidebar-width"
      label="settings.layout.sidebar.label"
      description={collapsed ? t('settings.layout.sidebar.desc.collapsed') : t('settings.layout.sidebar.desc')}
      valueText={t('settings.layout.sidebar.value', { width: Math.round(width) })}
      value={width}
      min={SIDEBAR_WIDTH.min}
      max={SIDEBAR_WIDTH.max}
      onChange={setSidebarWidth}
    />
  )
}

function SplitRatioRow() {
  const { t } = useT()
  const orientation = useAppStore(s => s.splitOrientation)
  const splitRatio = useAppStore(s => s.splitRatio)
  const setSplitRatio = useAppStore(s => s.setSplitRatio)
  // A drag leaves the ratio fractional (`delta / extent * 100`), and "47.31 / 52.69" is
  // not a readout. Presentation only: the stored value is left alone until this slider
  // is the thing that moves.
  const request = Math.round(splitRatio)

  return (
    <RangeRow
      id="settings-split-ratio"
      label="settings.layout.split.label"
      // Dotted keys are flat, so the orientation can be spliced in and still typecheck.
      description={t(`settings.layout.split.desc.${orientation}`)}
      valueText={t('settings.layout.split.value', { request, response: 100 - request })}
      value={splitRatio}
      min={SPLIT_RATIO.min}
      max={SPLIT_RATIO.max}
      onChange={setSplitRatio}
    />
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

  return (
    <div className="settings-row">
      <div className="settings-label">
        <label htmlFor="settings-language">{t('settings.language.label')}</label>
        <p id="settings-language-desc">{t('settings.language.desc')}</p>
      </div>
      <select
        id="settings-language"
        className="settings-select"
        aria-describedby="settings-language-desc"
        value={language}
        onChange={event => {
          const next = LANGUAGES.find(option => option.id === event.target.value)
          if (next) setLanguage(next.id)
        }}
      >
        {LANGUAGES.map(({ id, label }) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </div>
  )
}
