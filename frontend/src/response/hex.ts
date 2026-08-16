/**
 * The classic 16-byte hex dump. Sixteen because that is what every other tool uses and
 * what makes an offset column readable at a glance — the low nibble of the offset is
 * the column index.
 */
export const BYTES_PER_ROW = 16

/** Padded so the column never reflows as the offset crosses a power of sixteen. */
export const offsetLabel = (offset: number): string => offset.toString(16).padStart(8, '0')

const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'))

/**
 * The printable-ASCII gutter. Everything outside the printable range becomes a dot —
 * including the high half, which is deliberate: rendering byte 0x85 as whatever
 * Latin-1 says it is would invent a text encoding the dump is not claiming to know.
 */
const PRINTABLE_MIN = 0x20
const PRINTABLE_MAX = 0x7e

export interface HexRow {
  offset: number
  /** Exactly BYTES_PER_ROW entries; the tail of a short last row is empty strings. */
  cells: string[]
  ascii: string
}

/**
 * Builds one row on demand rather than the whole dump up front, so a 30 MB payload
 * costs nothing until it is scrolled into view. That is what lets the viewer render
 * from a window of rows instead of two million DOM nodes.
 */
export function hexRow(bytes: Uint8Array, index: number): HexRow {
  const offset = index * BYTES_PER_ROW
  const cells: string[] = []
  let ascii = ''
  for (let i = 0; i < BYTES_PER_ROW; i++) {
    const at = offset + i
    if (at >= bytes.length) {
      cells.push('')
      continue
    }
    const byte = bytes[at]
    cells.push(HEX[byte])
    ascii += byte >= PRINTABLE_MIN && byte <= PRINTABLE_MAX ? String.fromCharCode(byte) : '.'
  }
  return { offset, cells, ascii }
}

export const rowCount = (length: number): number => Math.ceil(length / BYTES_PER_ROW)

/**
 * The bytes behind a textual body, so "view as hex" works on every response and not
 * only the ones Go retained. Re-encoding the string is exact: it reached the frontend
 * as UTF-8 and `TextEncoder` only emits UTF-8.
 */
export const encodeText = (text: string): Uint8Array => new TextEncoder().encode(text)
