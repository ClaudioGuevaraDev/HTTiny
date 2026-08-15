import { useSyncExternalStore } from 'react'
import { currentLocale, setLocale, subscribeLocale, translatorFor, type Translator } from './i18n'
import { useAppStore } from './store'
import type { Locale } from './types'

/**
 * The bridge between the stored preference and the message runtime — the language
 * counterpart of `theme.ts`, and deliberately the same shape.
 *
 * `lang` on the document is not decoration: it is what the webview uses for
 * hyphenation and spellchecking, and what a screen reader reads to pick a voice. A
 * Spanish interface announced by an English synthesiser is close to unintelligible.
 */
const applyLanguage = (locale: Locale) => {
  setLocale(locale)
  document.documentElement.lang = locale
}

/**
 * Applies the stored language and keeps it applied.
 *
 * Called from `main.tsx` between `hydrate()` and `createRoot`, for the same reason the
 * theme is: the first paint has to be in the right language, and a repaint from English
 * to Spanish is worse than a slightly later one. The catalogues are static imports, so
 * there is nothing to await here — that is the dividend of shipping two languages in
 * the bundle rather than fetching them.
 *
 * The subscription is never torn down; it lives as long as the window. It only ever
 * writes *outward* — into the runtime and the DOM, never back into the store, which is
 * what keeps the autosave subscriber from re-entering itself forever.
 */
export function initLanguage(): void {
  applyLanguage(useAppStore.getState().language)

  let current = useAppStore.getState().language
  useAppStore.subscribe(state => {
    if (state.language === current) return
    current = state.language
    applyLanguage(current)
  })
}

/** Subscribes to the runtime rather than the store, so a locale change re-renders every consumer. */
export const useLocale = (): Locale => useSyncExternalStore(subscribeLocale, currentLocale)

/**
 * What components translate with: `const { t } = useT()`, plus `plural` where a count
 * is involved. Both come from a table built once per locale, so the identity is stable
 * and safe to list as a hook dependency.
 */
export const useT = (): Translator => translatorFor(useLocale())
