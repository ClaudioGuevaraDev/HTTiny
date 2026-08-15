import { useSyncExternalStore } from 'react'
import { useAppStore } from './store'
import type { ThemePreference } from './types'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** What `system` currently means. Wired to the OS setting through the webview. */
export const systemTheme = (): 'light' | 'dark' => (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light')

export const resolveTheme = (preference: ThemePreference): 'light' | 'dark' => (preference === 'system' ? systemTheme() : preference)

/**
 * CSS only ever sees a resolved theme. Keeping `system` out of the stylesheet is
 * what lets the palettes be two flat blocks instead of each one being duplicated
 * inside a `prefers-color-scheme` query.
 */
const applyTheme = (preference: ThemePreference) => {
  document.documentElement.dataset.theme = resolveTheme(preference)
}

/**
 * Applies the stored preference and keeps it applied.
 *
 * Called from `main.tsx` between `hydrate()` and `createRoot`, for the same reason
 * hydration is: the first paint has to be in the right theme, and a repaint from
 * dark to light is worse than a slightly later one.
 *
 * Two sources can change what is shown — the user picking a theme, and the OS
 * flipping under `system` — so both are subscribed. Neither is torn down: this
 * lives as long as the window does.
 */
export function initTheme(): void {
  applyTheme(useAppStore.getState().theme)

  let current = useAppStore.getState().theme
  useAppStore.subscribe(state => {
    if (state.theme === current) return
    current = state.theme
    applyTheme(current)
  })

  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    if (useAppStore.getState().theme === 'system') applyTheme('system')
  })
}

const subscribeSystemTheme = (onChange: () => void) => {
  const query = window.matchMedia(DARK_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * For the one place that has to *say* what `system` resolves to. Reading
 * `systemTheme()` during render would leave that sentence stale the moment the OS
 * flipped, since nothing in the store changes when it does.
 */
export const useSystemTheme = (): 'light' | 'dark' => useSyncExternalStore(subscribeSystemTheme, systemTheme)
