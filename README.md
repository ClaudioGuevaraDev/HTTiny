# HTTiny

HTTiny is a compact desktop HTTP client built with Wails v3, Go, React and Tailwind CSS.

## Development

Requirements: Go 1.24+, Node.js, pnpm, the Wails v3 CLI, and the native GTK/WebKit dependencies for your platform.

```bash
cd frontend
pnpm install
pnpm run dev
```

To run the native application with hot reload:

```bash
wails3 task dev
```

The first stage uses deterministic mock responses. HTTP networking and persistence are intentionally reserved for later stages.
