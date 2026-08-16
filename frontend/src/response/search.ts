/**
 * Finding text in a response.
 *
 * Deliberately independent of CodeMirror. The editor could answer "where are the
 * matches" through `@codemirror/search`, but the viewer already holds the formatted
 * body as a string, and the headers tab has no editor at all — so one plain `RegExp`
 * over a string serves both surfaces, and the match count the bar needs comes out of
 * the same pass. The editor's only job is to scroll to a range it is handed.
 */

export interface SearchOptions {
  caseSensitive: boolean
  regexp: boolean
}

export interface Match {
  from: number
  to: number
}

/** Anything with meaning inside a pattern, escaped when the user is not writing one. */
const escapePattern = (source: string): string => source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Builds the pattern, or `null` when there is nothing to search for.
 *
 * A regular expression the user is halfway through typing — `[`, `(`, `a{` — is not an
 * error worth reporting. It simply has no matches yet, and reporting it as a failure
 * would put an error message on screen after every single keystroke that opens a
 * bracket. `null` covers both "empty query" and "not a valid pattern yet", because the
 * bar renders them the same way.
 *
 * `g` is always set: every caller iterates. `y` is not, because matches may be anywhere.
 */
export function buildPattern(query: string, options: SearchOptions): RegExp | null {
  if (!query) return null
  const source = options.regexp ? query : escapePattern(query)
  const flags = options.caseSensitive ? 'g' : 'gi'
  try {
    return new RegExp(source, flags)
  } catch {
    return null
  }
}

/**
 * Every match in `text`, in document order.
 *
 * The zero-length guard is not theoretical: `.*` and `a?` both match the empty string,
 * and `RegExp.exec` with `g` does not advance `lastIndex` past one — the loop would
 * never end. Nudging it by one is what every implementation of this does.
 *
 * Capped, because the cost here is paid on every keystroke against a body that can be
 * five megabytes. A search with more hits than this is not a search anyone is reading
 * the results of one by one; the bar says the count was capped.
 */
export const MAX_MATCHES = 5000

export function findMatches(text: string, pattern: RegExp | null): Match[] {
  if (!pattern || !text) return []
  const matches: Match[] = []
  // A fresh instance rather than resetting `lastIndex` on the caller's: the pattern is
  // memoised and shared with the headers path, and a stateful regex shared between two
  // loops resumes in the middle of the second one.
  const scanner = new RegExp(pattern.source, pattern.flags)
  let match: RegExpExecArray | null
  while ((match = scanner.exec(text)) !== null) {
    matches.push({ from: match.index, to: match.index + match[0].length })
    if (match[0].length === 0) scanner.lastIndex += 1
    if (matches.length >= MAX_MATCHES) break
  }
  return matches
}

/**
 * Wraps the index around the ends, so `next` on the last match returns to the first.
 * A search that stops dead at the bottom of the document makes you scroll back up by
 * hand to carry on.
 */
export const stepMatch = (index: number, delta: number, total: number): number => (total === 0 ? 0 : (index + delta + total) % total)

export interface Segment {
  text: string
  match: boolean
}

/**
 * Splits a string into alternating plain and matching runs, for the headers table.
 *
 * Returned as data rather than as HTML, so the caller renders `<mark>` elements through
 * React. Building a highlighted string would mean `dangerouslySetInnerHTML` over a
 * header value that came from someone else's server — the exact thing the response
 * viewer's old regex highlighter did, and the reason it was replaced.
 */
export function segments(text: string, pattern: RegExp | null): Segment[] {
  const matches = findMatches(text, pattern)
  if (matches.length === 0) return [{ text, match: false }]

  const out: Segment[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.from > cursor) out.push({ text: text.slice(cursor, match.from), match: false })
    out.push({ text: text.slice(match.from, match.to), match: true })
    cursor = match.to
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), match: false })
  return out
}
