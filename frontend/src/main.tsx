import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { hydrate } from './persistence'
// Self-hosted: the app is an offline desktop binary and cannot fetch webfonts at
// runtime. Imported here rather than through a CSS @import so Vite resolves the
// bare specifiers and rewrites the .woff2 asset URLs deterministically. Both must
// come before styles.css so the cascade order stays predictable.
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'

/**
 * Load the workspace before the first render.
 *
 * The store is built synchronously at module scope, but reading the file is an
 * async call into Go. Rendering afterwards is what keeps the first paint from being
 * an empty workspace that then jumps to the real one, and it is why the autosave
 * subscriber can never see the pre-load state and write `[]` over real collections
 * — `hydrate` installs it as its last act.
 *
 * `hydrate()` never rejects, so the app always paints. Until it resolves the window
 * shows its BackgroundColour, which is the same colour as the app shell, so the gap
 * is invisible rather than a white flash.
 */
void hydrate().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
