# HTTiny

HTTiny is a compact desktop HTTP client built with Wails v3, Go, React and Tailwind CSS.

## Development

Requirements: Go 1.26+ (as pinned in `go.mod`), Node.js 22+ and pnpm 11 (pinned in `frontend/package.json` through `packageManager`, so pnpm fetches the right version itself), the Wails v3 CLI, and the native GTK/WebKit dependencies for your platform.

```bash
cd frontend
pnpm install
pnpm run dev
```

To run the native application with hot reload:

```bash
wails3 task dev
```

Requests are executed by the Go process using `net/http`, so they are not subject to CORS and can set headers a browser forbids. The browser dev server (`pnpm run dev`) has no Go backend behind it, so it is useful for working on the interface but cannot send requests — use `wails3 task dev` for that.

Collections and requests are saved automatically to `workspace.json` under your user config directory (`%AppData%\HTTiny` on Windows, `~/Library/Application Support/HTTiny` on macOS, `$XDG_CONFIG_HOME/HTTiny` on Linux); set `HTTINY_DATA_DIR` to override it. Bearer tokens and basic-auth passwords are kept in the operating system's credential store rather than in that file, so the workspace is safe to copy or share.
