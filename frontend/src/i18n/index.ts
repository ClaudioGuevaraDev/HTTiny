import type { Locale } from '../types'
import { SLOT, type Catalog, type MessageKey, type Translate, type Translator, type Values } from './catalog'
import { en } from './en'
import { es } from './es'

/**
 * The message runtime.
 *
 * Deliberately not `i18next`. What it would buy — ICU MessageFormat, namespaces, lazy
 * backends, extraction tooling — is priced for a product with a dozen locales and
 * translators who never see the code. Here it would cost two dependencies, an async
 * `init()` that reintroduces exactly the ordering hazard `main.tsx` is built to avoid,
 * and *weaker* key typing than the eight lines in `catalog.ts`. The same reasoning that
 * kept `fuse.js` out of `commands.ts`.
 *
 * **This module must never import `store.ts`.** It owns the current locale itself, and
 * `language.ts` is the one bridge from the store to it. That is what lets `store.ts`
 * import `translate` for default node names without closing a cycle.
 */

const catalogs: Record<Locale, Catalog> = { en, es }

/** en and es both have only `one` and `other`, but `select` is asked rather than assumed. */
const pluralRules: Record<Locale, Intl.PluralRules> = { en: new Intl.PluralRules('en'), es: new Intl.PluralRules('es') }

/** An unknown slot is left standing rather than blanked: `{name}` on screen says what is missing. */
const interpolate = (message: string, values?: Values): string =>
  values ? message.replace(SLOT, (whole, name: string) => (name in values ? String(values[name]) : whole)) : message

const render = (locale: Locale, key: MessageKey, values?: Values): string => interpolate(catalogs[locale][key], values)

const renderPlural = (locale: Locale, root: string, count: number, values?: Values): string => {
  const category = pluralRules[locale].select(count)
  // `PluralRoot` is derived from exactly those keys that have both forms, so this is a
  // real key by construction — an invariant the compiler cannot follow through a
  // generic, which is what the assertion stands in for.
  const key = `${root}.${category === 'one' ? 'one' : 'other'}` as MessageKey
  return interpolate(catalogs[locale][key], { count, ...values })
}

/**
 * The public signatures in `catalog.ts` are generic, so every call site is checked
 * against the message it names; the implementations are plain, because a conditional
 * param tuple cannot be indexed from inside a generic body. The two meet through the
 * annotation on `Translator`, with nothing asserted.
 */
const makeTranslator = (locale: Locale): Translator => ({
  t: (key: MessageKey, values?: Values) => render(locale, key, values),
  plural: (root: string, count: number, values?: Values) => renderPlural(locale, root, count, values),
})

/**
 * Built eagerly, one per locale, at module scope.
 *
 * Not a lazily filled cache: `useT()` runs during render, and populating module state
 * there is the kind of side effect the React Compiler rules flag. Two locales is two
 * objects. Stable identity is also a hard requirement — `t` sits in the dependency
 * array of `useCommands`, and a fresh closure per render would rebuild the entire
 * command list on every keystroke in the URL bar.
 */
const translators: Record<Locale, Translator> = { en: makeTranslator('en'), es: makeTranslator('es') }

export const translatorFor = (locale: Locale): Translator => translators[locale]

// ── The current locale ─────────────────────────────────────────────────────────
// Mirrored here rather than read from the store, so this module stays leaf-level.
// `language.ts` is the only writer, seeded and kept in sync from the store exactly the
// way `theme.ts` keeps `data-theme` in sync.

let current: Locale = 'en'
const listeners = new Set<() => void>()

export const currentLocale = (): Locale => current

export const setLocale = (locale: Locale): void => {
  if (locale === current) return
  current = locale
  for (const listener of listeners) listener()
}

export const subscribeLocale = (onChange: () => void): (() => void) => {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/**
 * For call sites outside React — the store's default node names, the failure copy, and
 * the global key handler, whose listener is installed once with no dependencies.
 * Reads the locale at call time rather than capturing it, the same rule `runRequest`
 * follows for the document it sends.
 */
export const translate: Translate = (key: MessageKey, values?: Values) => render(current, key, values)

// ── Development-only parity audit ──────────────────────────────────────────────
// Vite strips this from the shipped binary. It covers the one failure the type system
// cannot see: a translation that renames a slot — `{name}` becoming `{nombre}` —
// which typechecks perfectly and then renders the brace on screen. Dropping a slot is
// allowed, because a Spanish singular is often better without the number in it.
if (import.meta.env.DEV) {
  const slotsOf = (message: string): string[] => [...message.matchAll(SLOT)].map(match => match[1])
  const source: Record<string, string> = en
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const translated: Record<string, string> = catalog
    for (const key of Object.keys(source)) {
      const known = new Set(slotsOf(source[key]))
      const extra = slotsOf(translated[key]).filter(slot => !known.has(slot))
      if (extra.length) console.error(`[i18n] ${locale}/${key}: unknown placeholder(s) ${extra.join(', ')}`)
    }
  }
}

export type { MessageKey, PlainMessageKey, Plural, PluralRoot, Translate, Translator } from './catalog'
