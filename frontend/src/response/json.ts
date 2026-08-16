/**
 * The shape of a parsed JSON document, flattened into rows for the tree viewer.
 *
 * Flattened rather than nested because the viewer renders a window of rows, the same
 * way the hex dump does: a 40 MB API response nests only a few levels deep but holds
 * hundreds of thousands of nodes, and a recursive component tree of those is not
 * something a browser lays out. A flat list with a depth on each row is, and collapsing
 * a node becomes a range skip rather than a re-render of a subtree.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type JsonKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

export interface JsonRow {
  /** Stable across expand and collapse, and unique: the path is the identity. */
  path: string
  depth: number
  /** The object key or array index this value sits under; empty at the root. */
  label: string
  kind: JsonKind
  /** Rendered form of a leaf. Empty for containers, which show their size instead. */
  value: string
  /** Child count, for containers only. */
  size: number
  /** True when this row has children and can therefore be collapsed. */
  container: boolean
}

const kindOf = (value: JsonValue): JsonKind => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  const type = typeof value
  if (type === 'object') return 'object'
  if (type === 'number') return 'number'
  if (type === 'boolean') return 'boolean'
  return 'string'
}

/**
 * The rendered form of a leaf. Narrowed with `typeof` rather than asserted off `kind`:
 * the two would agree today and there is nothing keeping them agreeing, and `String()`
 * over a value that turned out to be an object yields `[object Object]` on screen.
 */
const leafValue = (value: JsonValue): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return 'null'
}

/**
 * JSONPath-ish, and deliberately the dialect people paste into other tools: `$` for the
 * root, `.key` for an identifier-shaped key, `['key']` for anything else, `[0]` for an
 * index. That is what makes "copy path" worth having — the string is useful somewhere
 * that is not this application.
 */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const childPath = (parent: string, label: string, inArray: boolean): string => {
  if (inArray) return `${parent}[${label}]`
  return IDENTIFIER.test(label) ? `${parent}.${label}` : `${parent}['${label.replace(/'/g, "\\'")}']`
}

/** Guards against a document deep enough to blow the stack while flattening it. */
const MAX_DEPTH = 100

/**
 * Walks the document, emitting a row per value and skipping the subtrees of collapsed
 * containers.
 *
 * `collapsed` is a set of paths rather than a flag on each row, so expansion state
 * survives the document being reformatted, the language being switched, and the request
 * being sent again — the tree does not fold itself back up under you every time.
 */
export function flatten(root: JsonValue, collapsed: ReadonlySet<string>): JsonRow[] {
  const rows: JsonRow[] = []

  const walk = (value: JsonValue, path: string, label: string, depth: number) => {
    const kind = kindOf(value)
    const container = kind === 'object' || kind === 'array'
    const entries: [string, JsonValue][] = !container
      ? []
      : kind === 'array'
        ? (value as JsonValue[]).map((item, index) => [String(index), item])
        : Object.entries(value as Record<string, JsonValue>)

    rows.push({
      path,
      depth,
      label,
      kind,
      value: container ? '' : leafValue(value),
      size: entries.length,
      container: container && entries.length > 0,
    })

    if (!container || collapsed.has(path) || depth >= MAX_DEPTH) return
    for (const [key, child] of entries) walk(child, childPath(path, key, kind === 'array'), key, depth + 1)
  }

  walk(root, '$', '', 0)
  return rows
}

/**
 * Every container path in the document, for "collapse all".
 *
 * Walks the whole tree regardless of what is currently collapsed, which is the point:
 * collapsing all has to reach nodes that are not on screen.
 */
export function containerPaths(root: JsonValue): string[] {
  const paths: string[] = []
  const walk = (value: JsonValue, path: string, depth: number) => {
    if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return
    const entries: [string, JsonValue][] = Array.isArray(value) ? value.map((item, index) => [String(index), item]) : Object.entries(value)
    if (entries.length === 0) return
    paths.push(path)
    const inArray = Array.isArray(value)
    for (const [key, child] of entries) walk(child, childPath(path, key, inArray), depth + 1)
  }
  walk(root, '$', 0)
  return paths
}

/**
 * Parses without throwing. `null` means "not a JSON document", which the caller renders
 * as the text it already has rather than as an error — the same rule the pretty printer
 * follows.
 */
export function parseJson(source: string): JsonValue | null {
  try {
    return JSON.parse(source) as JsonValue
  } catch {
    return null
  }
}
