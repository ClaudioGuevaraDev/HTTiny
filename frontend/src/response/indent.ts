/**
 * Re-indenting for the formats that have no parser here.
 *
 * These are deliberately shallow: they reflow whitespace between tokens and nothing
 * else. A minified SOAP envelope or a one-line CSS bundle becomes readable, which is
 * the whole ask; neither of these is a formatter and neither should ever be pointed at
 * a file you intend to keep.
 *
 * The contract they share with the JSON one in `responseBody.ts` is the important part:
 * **input that cannot be understood comes back byte-for-byte unchanged.** Half-
 * transforming a body the viewer misread would be worse than leaving it minified,
 * because the reader would have no way to tell which parts are the server's.
 */

const INDENT = '  '

/** Everything inside these is content, not markup, and must survive untouched. */
const RAW_ELEMENTS = new Set(['script', 'style', 'pre', 'textarea'])

/** Void elements never open a level, so nothing after them shifts right. */
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

/**
 * Splits markup into tags and the text between them, without a tokeniser.
 *
 * The regex has to be this careful about quotes: an attribute value may legitimately
 * contain `>` (`content="a > b"`), and splitting on the bare character turns one tag
 * into two and corrupts the output. Comments, CDATA, doctypes and processing
 * instructions are matched whole for the same reason — a `>` inside a comment is not
 * the end of anything.
 */
const MARKUP = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[!?][^>]*>|<\/?[^<>]*?(?:"[^"]*"|'[^']*'|[^"'<>])*?>/g

interface Piece {
  text: string
  tag: boolean
}

function split(source: string): Piece[] {
  const pieces: Piece[] = []
  let cursor = 0
  for (const match of source.matchAll(MARKUP)) {
    if (match.index > cursor) pieces.push({ text: source.slice(cursor, match.index), tag: false })
    pieces.push({ text: match[0], tag: true })
    cursor = match.index + match[0].length
  }
  if (cursor < source.length) pieces.push({ text: source.slice(cursor), tag: false })
  return pieces
}

const tagName = (tag: string): string => /^<\/?\s*([a-zA-Z0-9:_.-]+)/.exec(tag)?.[1].toLowerCase() ?? ''

/**
 * Indents XML, HTML, SVG and anything else angle-bracketed.
 *
 * Text between tags is emitted on its own line only when it survives trimming, so
 * `<b>hola</b>` does not become three lines — the common case of a leaf element with a
 * short value stays on one, which is what makes the output readable rather than merely
 * indented.
 */
export function indentMarkup(source: string): string {
  const pieces = split(source)
  if (pieces.length === 0) return source

  const lines: string[] = []
  let depth = 0
  // Non-empty while inside <script>, <style>, <pre> or <textarea>. Their content is
  // reproduced exactly: re-indenting the inside of a <pre> changes what it renders,
  // and re-indenting a script changes nothing but makes the diff a lie.
  let raw = ''
  let pending = ''

  const flush = () => {
    const text = pending.trim()
    pending = ''
    if (text) lines.push(INDENT.repeat(depth) + text)
  }

  for (const piece of pieces) {
    if (raw) {
      pending += piece.text
      if (piece.tag && piece.text.startsWith('</') && tagName(piece.text) === raw) {
        raw = ''
        const closing = pending.slice(pending.lastIndexOf('<'))
        const content = pending.slice(0, pending.length - closing.length)
        pending = ''
        if (content.trim()) lines.push(content.replace(/^\n+|\s+$/g, ''))
        depth = Math.max(0, depth - 1)
        lines.push(INDENT.repeat(depth) + closing)
      }
      continue
    }

    if (!piece.tag) {
      pending += piece.text
      continue
    }

    const name = tagName(piece.text)
    const closing = piece.text.startsWith('</')
    const selfClosing = piece.text.endsWith('/>') || piece.text.startsWith('<!') || piece.text.startsWith('<?') || VOID_ELEMENTS.has(name)

    if (closing) {
      // `<b>hola</b>`: keep the value on the line its element opened, rather than
      // spending three lines on a leaf.
      const inline = pending.trim()
      pending = ''
      if (inline && lines.length > 0 && lines[lines.length - 1].trimStart().startsWith('<') && !lines[lines.length - 1].trimStart().startsWith('</')) {
        lines[lines.length - 1] += inline + piece.text
        depth = Math.max(0, depth - 1)
        continue
      }
      if (inline) lines.push(INDENT.repeat(depth) + inline)
      depth = Math.max(0, depth - 1)
      lines.push(INDENT.repeat(depth) + piece.text)
      continue
    }

    flush()
    lines.push(INDENT.repeat(depth) + piece.text)
    if (!selfClosing) {
      depth++
      if (RAW_ELEMENTS.has(name)) raw = name
    }
  }
  flush()

  const out = lines.join('\n')
  // A source that produced nothing recognisable is handed back rather than replaced
  // with an empty editor.
  return out.trim() ? out : source
}

/**
 * Indents CSS, and the brace-and-semicolon shape of a JavaScript bundle well enough to
 * find your way around one.
 *
 * String and comment awareness is the entire difficulty: a `{` inside a URL, a regex or
 * a template literal must not open a level, and a `;` inside a string must not break a
 * line. Everything else is a counter.
 */
export function indentBraces(source: string): string {
  const lines: string[] = []
  let line = ''
  let depth = 0
  let quote = ''
  let comment: '' | 'line' | 'block' = ''

  const push = () => {
    const text = line.trim()
    line = ''
    if (text) lines.push(INDENT.repeat(Math.max(0, depth)) + text)
  }

  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    const next = source[i + 1]

    if (comment === 'line') {
      if (char === '\n') {
        comment = ''
        push()
      } else line += char
      continue
    }
    if (comment === 'block') {
      line += char
      if (char === '*' && next === '/') {
        line += next
        i++
        comment = ''
        push()
      }
      continue
    }
    if (quote) {
      line += char
      // A backslash escapes the next character whatever it is, including the quote.
      if (char === '\\' && next !== undefined) {
        line += next
        i++
      } else if (char === quote) quote = ''
      continue
    }

    if (char === '/' && next === '/') {
      line += '//'
      i++
      comment = 'line'
      continue
    }
    if (char === '/' && next === '*') {
      line += '/*'
      i++
      comment = 'block'
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      line += char
      continue
    }

    if (char === '{') {
      line += char
      push()
      depth++
      continue
    }
    if (char === '}') {
      push()
      depth = Math.max(0, depth - 1)
      line = char
      push()
      continue
    }
    if (char === ';') {
      line += char
      push()
      continue
    }
    if (char === '\n' || char === '\r') {
      push()
      continue
    }
    line += char
  }
  push()

  const out = lines.join('\n')
  return out.trim() ? out : source
}
