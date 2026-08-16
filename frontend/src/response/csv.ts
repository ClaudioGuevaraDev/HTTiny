/**
 * An RFC 4180 CSV reader, hand-rolled for the same reason the fuzzy matcher in
 * `commands.ts` and the i18n catalogue are: the whole grammar is quoting rules and a
 * state machine, and a dependency would be larger than the thing it replaces.
 *
 * What it handles, because these are the parts people get wrong: quoted fields, escaped
 * quotes (`""`), delimiters and newlines *inside* quotes, and CRLF. What it does not do
 * is type inference — every cell stays a string, because a response viewer's job is to
 * show what arrived, and deciding that `007` is the number seven would be editing it.
 */

/** In order of how strong the evidence has to be. Tab first: it is never incidental. */
const CANDIDATES = ['\t', ';', ',', '|'] as const
export type Delimiter = (typeof CANDIDATES)[number]

/**
 * Guesses the delimiter from the first few lines.
 *
 * Counting occurrences alone picks the wrong character constantly — prose in a
 * one-column file is full of commas. What actually identifies a delimiter is
 * *consistency*: a real one produces the same field count on every row. So each
 * candidate is scored by how many of the sampled rows agree with the first, and ties
 * break toward more columns, since a delimiter that finds structure beats one that
 * finds none.
 */
export function detectDelimiter(source: string): Delimiter {
  const sample = source.split('\n', 20).filter(line => line.trim())
  if (sample.length === 0) return ','

  let best: Delimiter = ','
  let bestScore = -1
  for (const candidate of CANDIDATES) {
    const counts = sample.map(line => countOutsideQuotes(line, candidate))
    if (counts[0] === 0) continue
    const agree = counts.filter(count => count === counts[0]).length
    const score = agree * 100 + Math.min(counts[0], 50)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') i++
      else quoted = !quoted
    } else if (char === delimiter && !quoted) count++
  }
  return count
}

export interface Table {
  header: string[]
  rows: string[][]
  /** True when at least one row carried a different number of cells than the header. */
  ragged: boolean
}

/**
 * Parses the whole body into rows.
 *
 * The first row is treated as a header. That is a guess, and a wrong one for a headless
 * export — but a table whose first row is data still reads correctly, only mislabelled,
 * whereas refusing to guess would leave every column called "1".
 */
export function parseCsv(source: string, delimiter: Delimiter): Table {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    // A trailing newline produces one empty final row, which is an artefact of the
    // file ending rather than a record.
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
  }

  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += char
      continue
    }
    if (char === '"' && field === '') {
      quoted = true
      continue
    }
    if (char === delimiter) {
      endField()
      continue
    }
    if (char === '\r') continue
    if (char === '\n') {
      endRow()
      continue
    }
    field += char
  }
  if (field !== '' || row.length > 0) endRow()

  const [header = [], ...body] = rows
  return { header, rows: body, ragged: body.some(entry => entry.length !== header.length) }
}
