import { useAppStore } from './store'

/**
 * Overrides `--text-code` from the root's inline style, which beats the token declared in
 * `theme.css` without the stylesheet having to know this exists. That token feeds exactly
 * two surfaces — both editors, through `editorTheme.ts` — so nothing in the chrome moves
 * with it. `--text-code--line-height` is left alone on purpose: it is a unitless 1.6, so
 * it already follows the size.
 */
const applyCodeFontSize = (size: number) => {
  document.documentElement.style.setProperty('--text-code', `${size}px`)
}

/**
 * Applies the stored code font size and keeps it applied.
 *
 * Deliberately a near-copy of `initZoom` rather than the two of them folded into one
 * generic: it is ten lines of guarded subscription, and a helper parameterised over "which
 * custom property" would read worse than the two plain cases do.
 *
 * Called from `main.tsx` between `hydrate()` and `createRoot`, like the theme, the
 * language and the zoom — the first paint has to come out at the right size.
 */
export function initCodeFontSize(): void {
  applyCodeFontSize(useAppStore.getState().codeFontSize)

  let current = useAppStore.getState().codeFontSize
  useAppStore.subscribe(state => {
    if (state.codeFontSize === current) return
    current = state.codeFontSize
    applyCodeFontSize(current)
  })
}
