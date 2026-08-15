import { useAppStore } from './store'

/**
 * One custom property drives everything: `base.css` declares `zoom: var(--zoom, 1)` on the
 * root, and the two rules that size a dialog against the viewport divide by the same
 * variable. Viewport units are the one thing `zoom` does not compose with — a `92vw`
 * resolves against the unscaled viewport and is *then* multiplied, so at 150% it would
 * reach past the window edge.
 *
 * `setProperty` rather than assigning `style.zoom`, so nothing here depends on how the DOM
 * lib happens to type a property CSS inherited from IE.
 */
const applyZoom = (zoom: number) => {
  document.documentElement.style.setProperty('--zoom', String(zoom / 100))
}

/**
 * Applies the stored zoom and keeps it applied.
 *
 * Called from `main.tsx` between `hydrate()` and `createRoot`, exactly like `initTheme`:
 * the first paint has to come out at the right scale rather than be rescaled in front of
 * the user. Only one source can change it — the store — so unlike the theme there is no
 * second subscription, and like the theme it is never torn down.
 */
export function initZoom(): void {
  applyZoom(useAppStore.getState().zoom)

  let current = useAppStore.getState().zoom
  useAppStore.subscribe(state => {
    if (state.zoom === current) return
    current = state.zoom
    applyZoom(current)
  })
}
