import { useEffect } from 'react'
import { flushNow } from './persistence'
import { cancelRequest, toggleRequest } from './requestRunner'
import { matchesCombo } from './shortcuts'
import { useAppStore } from './store'

/**
 * One window listener with an empty dependency array. The previous effect listed
 * `responses` as a dependency, so it tore down and re-subscribed on every response
 * change; reading `getState()` inside the handler removes the need entirely.
 *
 * Only modifier combos and Escape are handled, so nothing fires while typing in a
 * key/value row or inside CodeMirror.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const state = useAppStore.getState()

      if (matchesCombo(event, 'mod+k')) {
        event.preventDefault()
        if (state.paletteOpen) state.closePalette()
        else state.openPalette('')
        return
      }

      if (matchesCombo(event, 'mod+,')) {
        event.preventDefault()
        if (state.settingsOpen) state.closeSettings()
        else state.openSettings()
        return
      }

      // Not `matchesCombo`, and deliberately so. It compares modifiers exactly, but on a
      // US keyboard `Ctrl++` arrives as `Ctrl+Shift+=` — a browser takes both, and so
      // should this. Its combo strings could not express it either, since the parser
      // splits on `+`. Numpad `+`/`-` land here too, as their own unshifted keys.
      const mod = (event.ctrlKey || event.metaKey) && !event.altKey
      if (mod && (event.key === '+' || event.key === '=')) {
        event.preventDefault()
        state.zoomIn()
        return
      }
      if (mod && (event.key === '-' || event.key === '_')) {
        event.preventDefault()
        state.zoomOut()
        return
      }
      if (mod && !event.shiftKey && event.key === '0') {
        event.preventDefault()
        state.resetZoom()
        return
      }

      // While either modal is open it owns the keyboard. Escape still closes them —
      // that is the dialog element's own behaviour, not this handler's. Zoom is above
      // this line with the palette and the settings: it has to answer while the panel
      // that offers it is open.
      if (state.paletteOpen || state.settingsOpen) return

      const id = state.activeId

      // Kept even though everything autosaves: it is universal muscle memory, and
      // it is a real escape hatch — it writes immediately instead of waiting out
      // the debounce. It is simply no longer the thing that makes saving happen.
      if (matchesCombo(event, 'mod+s')) {
        event.preventDefault()
        flushNow()
      } else if (matchesCombo(event, 'mod+enter') && id) {
        event.preventDefault()
        // Was `document.querySelector('.send-btn')?.click()`, which meant renaming a
        // CSS class silently broke the shortcut.
        toggleRequest(id)
      } else if (matchesCombo(event, 'mod+w') && id) {
        event.preventDefault()
        cancelRequest(id)
        state.closeRequest(id)
      } else if (matchesCombo(event, 'mod+b')) {
        event.preventDefault()
        state.toggleSidebar()
      } else if (matchesCombo(event, 'mod+\\')) {
        event.preventDefault()
        state.toggleSplitOrientation()
      } else if (matchesCombo(event, 'mod+n')) {
        event.preventDefault()
        state.addNode('request')
      } else if (event.key === 'Escape' && id && state.responses[id]?.state === 'loading') {
        cancelRequest(id)
      }
    }

    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [])
}
