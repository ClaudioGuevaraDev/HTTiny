import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// Self-hosted: the app is an offline desktop binary and cannot fetch webfonts at
// runtime. Imported here rather than through a CSS @import so Vite resolves the
// bare specifiers and rewrites the .woff2 asset URLs deterministically. Both must
// come before styles.css so the cascade order stays predictable.
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
