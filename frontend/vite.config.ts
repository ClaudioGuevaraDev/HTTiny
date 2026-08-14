import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Read at config time rather than importing package.json into the bundle, which
// would ship the whole dependency list to the client. The sidebar footer used to
// hardcode "v0.1" while package.json said 0.2.5; wiring it to the manifest means it
// cannot drift again.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WAILS_VITE_PORT ?? 5173),
    strictPort: true,
  },
})
