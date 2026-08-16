/**
 * A small Markdown renderer, hand-rolled like the fuzzy matcher in `commands.ts` and
 * the i18n catalogue, and for the same reason: the alternative is a dependency larger
 * than the feature.
 *
 * **This is a subset of CommonMark, not CommonMark.** It covers ATX headings, fenced
 * and indented code, unordered and ordered lists, blockquotes, thematic breaks, pipe
 * tables, paragraphs, and the inline set — code spans, strong, emphasis, strikethrough,
 * links, images and autolinks. It does not do setext headings, reference links, nested
 * blockquotes, loose/tight list distinctions, or HTML blocks. A document using those
 * renders imperfectly; nothing about it fails.
 *
 * The output is only ever placed inside an `<iframe sandbox="">`, which is what makes
 * the escaping here a correctness concern rather than a security one — the frame has an
 * opaque origin and no script execution, so the worst a malformed escape can produce is
 * a wrong-looking page. `escapeHtml` still runs on every text run, because a response
 * body full of `<div>` should read as a response body full of `<div>`.
 */

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/**
 * Only http, https and mailto reach an `href`. A `javascript:` or `data:` URL in a
 * link is inert inside the sandbox, but emitting one would still be writing an attack
 * into the document and hoping the container holds.
 */
const safeUrl = (url: string): string => {
  const trimmed = url.trim()
  return /^(https?:|mailto:|#|\/|\.{1,2}\/)/i.test(trimmed) ? escapeHtml(trimmed) : '#'
}

/**
 * A capturing split, so the code spans survive as pieces rather than as separators.
 * The negated class is what stops `` `a` and `b` `` collapsing into one span running
 * from the first backtick to the last.
 */
const CODE_SPAN = /(`[^`]+`)/g

/**
 * The destination part of a link or image: run of non-paren characters, or a balanced
 * `(…)` group, repeated.
 *
 * One level of nesting rather than none, because a URL containing parentheses is a real
 * thing — `…/wiki/Mercury_(planet)` — and stopping at the first `)` truncates the link
 * *and* leaves the stray bracket in the rendered text. One level is where CommonMark
 * itself stops caring too.
 */
const DESTINATION = String.raw`((?:[^()\s]|\([^()\s]*\))+)`
const LINK = new RegExp(String.raw`\[([^\]]+)\]\(${DESTINATION}(?:\s+"[^"]*")?\)`, 'g')
const IMAGE = new RegExp(String.raw`!\[([^\]]*)\]\(${DESTINATION}(?:\s+"[^"]*")?\)`, 'g')

/**
 * The inline rules that apply to ordinary text.
 *
 * Order is load-bearing throughout: images before links, since `![x](y)` also matches
 * the link pattern; strong before emphasis, so `**a**` is not read as two empty
 * emphases; and `escapeHtml` first, so every rule after it composes over safe text.
 */
function inlineText(source: string): string {
  let text = escapeHtml(source)
  text = text.replace(IMAGE, (_, alt: string, url: string) => `<img src="${safeUrl(url)}" alt="${alt}">`)
  text = text.replace(LINK, (_, label: string, url: string) => `<a href="${safeUrl(url)}">${label}</a>`)
  text = text.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (_, url: string) => `<a href="${safeUrl(url)}">${url}</a>`)
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/g, '<em>$1</em>')
  return text.replace(/~~([^~]+)~~/g, '<del>$1</del>')
}

/**
 * Inline rules over one text run, with code spans held out of them.
 *
 * Split rather than extract-and-restore. The usual trick — swap each span for a
 * placeholder, run the rules, put the spans back — needs a sentinel that cannot occur
 * in the input, and every candidate is either a control character, which has no place
 * in a regex here, or something a response might genuinely contain, at which point the
 * renderer silently corrupts a body. Splitting has nothing to collide with: the pieces
 * at odd indices are code and the rest is text, so `` `a *b* c` `` stays literal by
 * construction.
 */
function inline(source: string): string {
  return source
    .split(CODE_SPAN)
    .map((piece, index) => (index % 2 === 1 ? `<code>${escapeHtml(piece.slice(1, -1))}</code>` : inlineText(piece)))
    .join('')
}

const TABLE_DIVIDER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/
const splitRow = (line: string): string[] =>
  line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map(cell => cell.trim())

export function renderMarkdown(source: string): string {
  const lines = source.split(/\r\n|\r|\n/)
  const out: string[] = []
  let index = 0

  const paragraph: string[] = []
  const flushParagraph = () => {
    if (paragraph.length === 0) return
    out.push(`<p>${inline(paragraph.join('\n'))}</p>`)
    paragraph.length = 0
  }

  while (index < lines.length) {
    const line = lines[index]

    // Fenced code. The closing fence is optional: a truncated response ends mid-block
    // more often than not, and swallowing the rest as a paragraph would be worse.
    const fence = /^\s*(```+|~~~+)\s*([A-Za-z0-9_+-]*)\s*$/.exec(line)
    if (fence) {
      flushParagraph()
      const marker = fence[1][0]
      const body: string[] = []
      index++
      while (index < lines.length && !new RegExp(`^\\s*\\${marker}{3,}\\s*$`).test(lines[index])) {
        body.push(lines[index])
        index++
      }
      index++
      const language = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : ''
      out.push(`<pre><code${language}>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }

    if (/^\s*$/.test(line)) {
      flushParagraph()
      index++
      continue
    }

    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph()
      out.push('<hr>')
      index++
      continue
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      flushParagraph()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      index++
      continue
    }

    // Pipe table: a header row followed by a divider. Without the divider it is just a
    // paragraph containing pipes, which is a thing that happens in log output.
    if (line.includes('|') && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1])) {
      flushParagraph()
      const header = splitRow(line)
      index += 2
      const body: string[][] = []
      while (index < lines.length && lines[index].includes('|') && lines[index].trim() !== '') {
        body.push(splitRow(lines[index]))
        index++
      }
      const head = header.map(cell => `<th>${inline(cell)}</th>`).join('')
      const rows = body.map(row => `<tr>${header.map((_, i) => `<td>${inline(row[i] ?? '')}</td>`).join('')}</tr>`).join('')
      out.push(`<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`)
      continue
    }

    if (/^\s{0,3}>/.test(line)) {
      flushParagraph()
      const body: string[] = []
      while (index < lines.length && /^\s{0,3}>/.test(lines[index])) {
        body.push(lines[index].replace(/^\s{0,3}>\s?/, ''))
        index++
      }
      out.push(`<blockquote><p>${inline(body.join('\n'))}</p></blockquote>`)
      continue
    }

    const bullet = /^\s{0,3}([-*+]|\d{1,9}[.)])\s+/.exec(line)
    if (bullet) {
      flushParagraph()
      const ordered = /\d/.test(bullet[1])
      const items: string[] = []
      while (index < lines.length) {
        const item = /^\s{0,3}([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(lines[index])
        if (!item) break
        if (/\d/.test(item[1]) !== ordered) break
        items.push(`<li>${inline(item[2])}</li>`)
        index++
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`)
      continue
    }

    paragraph.push(line.trim())
    index++
  }
  flushParagraph()

  return out.join('\n')
}
