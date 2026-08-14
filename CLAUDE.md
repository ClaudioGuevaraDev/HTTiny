# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` holds the full contributor guidelines (style, commits, PRs). Read it too — this file covers commands, architecture, and the gotchas that only show up after reading several files.

## Commands

Frontend (run from `frontend/`, pnpm is pinned via `packageManager`):

```bash
pnpm install              # pnpm install --frozen-lockfile in CI/task runs
pnpm run dev              # Vite dev server in a plain browser (no lint)
pnpm run typecheck        # tsc -b, no emit
pnpm run lint             # typecheck + eslint . — compiler errors AND type-aware rules
pnpm run lint:fix         # eslint . --fix
pnpm run build            # lint && vite build -> frontend/dist/
pnpm run format           # prettier --write over src/ and root configs
pnpm run format:check     # same, report-only
```

`lint` is the gate that matters: `typescript-eslint` does not emit `tsc` diagnostics, so the script chains `tsc -b` before `eslint`. `build` runs `lint` first and therefore no longer calls `tsc -b` itself — a lint failure aborts the build before Vite runs, on every path including `wails3 task build` and the blocking build step inside `wails3 dev`.

Native app (from repo root, requires the `wails3` CLI):

```bash
wails3 task dev           # wails3 dev with frontend hot reload, driven by build/config.yml
wails3 task build         # builds frontend/dist/, then go build -o bin/HTTiny .
wails3 task run           # build + launch bin/HTTiny
```

Verification gate before submitting: `pnpm run lint` and `pnpm run build`, then manual checks in Vite or Wails. There is intentionally **no test framework** at this stage — do not add testing dependencies unless the project direction changes.

Lint/format config lives in `frontend/eslint.config.js` (ESLint 10 flat config: `recommendedTypeChecked` via `projectService`, `react-hooks` flat recommended — which includes the React Compiler rules — plus `react-refresh`, with `eslint-config-prettier` last) and `frontend/.prettierrc.json`. Prettier is tuned to the existing compact style (`semi: false`, `singleQuote`, `arrowParens: "avoid"`, `printWidth: 160`) and is deliberately **not** part of the lint/build gate: the existing `src/` files predate it and `format:check` reports them as unformatted. Format a file only when you are already editing it.

## Architecture

Wails v3 desktop shell + React SPA. The Go side is deliberately thin: `main.go` embeds `frontend/dist` via `//go:embed all:frontend/dist`, opens a single 1440×900 webview window, and **binds no methods** — there is no Go↔JS service layer yet. All behavior lives in the frontend.

HTTP networking and persistence are not implemented. `frontend/src/mockExecutor.ts` is the only executor, satisfying the `RequestExecutor` interface in `types.ts`; real networking is meant to arrive as a second implementation of that interface (likely Go-bound), so keep call sites depending on `RequestExecutor`, not on `mockExecutor` directly. Today `RequestEditor.tsx` imports `mockExecutor` concretely — that import is the seam to replace.

State: one Zustand store (`src/store.ts`) owns everything shared. Two parallel structures:

- `tree: TreeNode[]` — the sidebar hierarchy (collection / folder / request), recursively transformed by the local `mapTree` / `insertNode` / `removeNode` helpers. All updates are immutable rebuilds of the affected path.
- `documents: Record<string, RequestDocument>` — request payloads keyed by **request id**, plus `tabs` (ordered request ids), `activeId`, and `responses` keyed by the same request id.

A `RequestNode` therefore carries two ids: its own `id` (tree node identity) and `requestId` (document key). Getting them crossed is the easiest bug to introduce here. Related gotcha: `setActive`/`openRequest` derive `selectedNodeId` as `` `node-${activeId}` ``, which only matches the seeded fixtures in `data.ts` (`node-users`, …) — nodes created by `addNode` get ids like `request-<timestamp>`, so sidebar selection does not follow tab changes for them. Fix by storing the real node id if you touch this.

`ResponseSnapshot` is a discriminated union on `state` (`idle | loading | error | success`) — branch on it exhaustively rather than checking for optional fields. Cancellation flows through an `AbortController` created in `RequestEditor`, handed up to `App.tsx` via the `onController` callback so the global Escape shortcut can abort.

Layout and shortcuts live in `App.tsx`: a CSS-grid shell with pointer-event resizers (sidebar width in px, request/response split as an `fr` percentage) and window-level `Ctrl/Cmd+S` (save), `Ctrl/Cmd+W` (close, confirming when `dirty`), `Ctrl/Cmd+Enter` (send, dispatched by clicking `.send-btn`), and `Escape` (abort in-flight).

URL and query params stay bidirectionally synced: editing param rows rewrites the URL through `replaceQuery` (preserving any `#hash`), and blurring the URL input re-derives rows via `parseParams`, reusing existing row ids so React keys and descriptions survive.

## Project rules (from AGENTS.md)

- **Exact dependency versions only** — no `^`, `~`, `>`, `*`. Use `pnpm add pkg@1.2.3`, commit the lockfile, keep `go.mod` pinned and `go.sum` intact.
- **Version sync** — when the user explicitly asks for the `conventional-commit` skill, bump the app version (`A.B.C`, never `A`) in *both* `frontend/package.json` and `build/config.yml` before staging, plus any future manifest exposing the version. Minor bump (reset patch) for a new user-facing feature or meaningful capability change; patch bump for fixes, docs, styling, refactors, dependency/build work. Never touch Taskfile `version: '3'`.
- **Indentation** — tabs in Go, two spaces in TS/TSX/JSON/YAML. Format Go with `gofmt`. Strict TypeScript types; avoid `any`.
- **Naming** — `PascalCase` for React components and exported types, `camelCase` for functions and store actions, descriptive kebab-free filenames (`RequestEditor.tsx`).
- **Separation of concerns** — keep components focused; shared state, fixtures, and request-execution logic stay out of presentation components (hence `store.ts`, `data.ts`, `mockExecutor.ts`).
- Styling is Tailwind v4 (via `@tailwindcss/vite`, no config file) plus semantic classes defined in `src/styles.css` — most markup uses those shared class names (`app-shell`, `kv-row`, `technical-input`, …). Preserve the compact dark UI with the green accent.
- **Never commit generated output**: `frontend/dist/`, `frontend/node_modules/`, `bin/` (all in `.gitignore`).
- **Linux dev** needs GTK4 and WebKitGTK 6.0 development packages. README states Go 1.24+; `go.mod` currently requires 1.26.
- PRs should explain the behavior changed, list manual verification steps, include screenshots/recordings for visual changes, reference related issues, and call out new dependencies, Wails config changes, or platform-specific requirements. Keep unrelated changes in separate commits.
- Commit style: AGENTS.md prescribes concise imperative subjects (`Add response error states`) and says no history is established yet, but the existing history uses Conventional Commits (`feat(app): …`, `chore(skills): …`). Match the actual history unless told otherwise.

## Other gotchas

- Skills live in `.agents/skills/` (the real directories, tracked in git); `.claude/skills/*` are relative symlinks into them, and `skills-lock.json` records each upstream source. Add or edit skills under `.agents/skills/`, then symlink them: `ln -s ../../.agents/skills/<name> .claude/skills/<name>`. A skill without that symlink is invisible to Claude Code and cannot be invoked — that is how `conventional-commit` was unreachable despite AGENTS.md depending on it.
- Manual error-state testing: `mockExecutor` keys off substrings in the URL — `timeout`, `dns-error`, `refused` — and a non-`http(s)` URL yields `INVALID_URL`. Copy for each code lives in `errorCopy`.
