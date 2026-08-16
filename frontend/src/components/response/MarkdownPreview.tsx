import { useMemo } from 'react'
import { useT } from '../../language'
import { renderMarkdown } from '../../response/markdown'

/**
 * The stylesheet the rendered document is dressed in.
 *
 * Inlined into the frame because an empty sandbox has an opaque origin and cannot load
 * an external stylesheet — and because the frame must not reach back into the app for
 * anything, which is the point of the sandbox. The colours are literals rather than
 * `var(--color-text)` for the same reason: custom properties do not cross a document
 * boundary, and the frame has no access to the app's `:root`.
 *
 * `color-scheme` plus a `prefers-color-scheme` block is how the frame follows the OS
 * without being told. It will disagree with the app when the user has forced light or
 * dark against their system setting — an acceptable seam for a preview of somebody
 * else's document, and better than passing a theme in and re-rendering the frame on
 * every toggle.
 */
const FRAME_CSS = `
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 20px 24px 40px;
    font: 14px/1.65 system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: #1d1d21; background: #ffffff;
    overflow-wrap: anywhere;
  }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.6em; }
  h1 { font-size: 1.7em; } h2 { font-size: 1.4em; } h3 { font-size: 1.15em; }
  h1, h2 { padding-bottom: 0.25em; border-bottom: 1px solid #e2e2e6; }
  p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
  ul, ol { padding-left: 1.6em; }
  li { margin: 0.25em 0; }
  a { color: #0a66c2; }
  code { font: 0.88em/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
         background: #f2f2f5; padding: 0.15em 0.35em; border-radius: 3px; }
  pre { background: #f2f2f5; padding: 12px 14px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { padding-left: 14px; border-left: 3px solid #d5d5db; color: #55555f; }
  hr { height: 1px; border: 0; background: #e2e2e6; margin: 2em 0; }
  table { border-collapse: collapse; display: block; overflow-x: auto; }
  th, td { border: 1px solid #e2e2e6; padding: 6px 10px; text-align: left; }
  th { background: #f7f7f9; }
  img { max-width: 100%; }
  @media (prefers-color-scheme: dark) {
    body { color: #d0d0d7; background: #0e0e11; }
    h1, h2 { border-bottom-color: #2a2a30; }
    a { color: #7dd3fc; }
    code, pre { background: #17171b; }
    blockquote { border-left-color: #2a2a30; color: #8d8d98; }
    hr { background: #2a2a30; }
    th, td { border-color: #2a2a30; }
    th { background: #17171b; }
  }
`

/**
 * A Markdown response, rendered.
 *
 * Same frame and same rules as `HtmlPreview`: `sandbox=""` denies scripts, forms,
 * navigation and same-origin access, and there is no `<base>`, so a remote image in the
 * document does not load. That last part is why `img { max-width }` above matters
 * anyway — a data-URI image will render, and an oversized one should not blow out the
 * column.
 *
 * The renderer is a documented subset of CommonMark (see `response/markdown.ts`), which
 * is the trade for not adding a dependency. It is safe to be relaxed about that here
 * precisely because of the sandbox: the worst a parsing mistake produces is a page that
 * looks wrong, never one that does anything.
 */
export function MarkdownPreview({ source }: { source: string }) {
  const { t } = useT()
  const html = useMemo(() => `<!doctype html><meta charset="utf-8"><style>${FRAME_CSS}</style>${renderMarkdown(source)}`, [source])

  return (
    <div className="html-preview">
      <iframe className="html-frame" title={t('response.markdown.title')} sandbox="" srcDoc={html} referrerPolicy="no-referrer" />
    </div>
  )
}
