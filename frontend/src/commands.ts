import type { PlainMessageKey, Translate } from './i18n'
import type { HttpMethod, Locale, RequestDocument, TreeNode } from './types'

export type CommandGroup = 'navigation' | 'action' | 'request' | 'method'

export interface Command {
  id: string
  group: CommandGroup
  title: string
  subtitle?: string
  /** Pre-lowercased haystack: URL, breadcrumb, synonyms. */
  keywords: string
  method?: HttpMethod
  shortcut?: readonly string[]
  /** Reads `useAppStore.getState()` itself, so command identity never depends on
   * a captured snapshot. */
  run: () => void
}

export interface CommandMatch extends Command {
  score: number
  ranges: [number, number][]
}

const GROUP_WEIGHT: Record<CommandGroup, number> = { navigation: 0, action: 1, request: 2, method: 3 }

const GROUP_LABEL: Record<CommandGroup, PlainMessageKey> = {
  navigation: 'palette.group.navigation',
  action: 'palette.group.action',
  request: 'palette.group.request',
  method: 'palette.group.method',
}

/**
 * Strips diacritics so `parametros` finds `Parámetros`.
 *
 * Length-preserving on purpose, one character in and one out: `ranges` indexes into the
 * untouched title to place the `<mark>` elements, so the usual
 * `normalize('NFD').replace(/\p{Diacritic}/gu, '')` — which changes every offset after
 * the first accent — would highlight the wrong characters.
 */
const fold = (text: string): string => text.replace(/[À-ɏ]/g, char => char.normalize('NFD')[0])

/**
 * Subsequence matcher. Deliberately hand-rolled rather than pulling in `cmdk` or
 * `fuse.js`: the dependency policy makes every addition a deliberate act, and this
 * is cheaper than a transitive tree for what it does.
 */
export function fuzzyScore(query: string, text: string): { score: number; ranges: [number, number][] } | null {
  if (!query) return { score: 0, ranges: [] }
  const haystack = fold(text.toLowerCase())
  const needle = fold(query.toLowerCase())
  const ranges: [number, number][] = []
  let score = 0
  let index = 0
  let previous = -2

  for (const char of needle) {
    const found = haystack.indexOf(char, index)
    if (found === -1) return null
    score += 16
    if (found === previous + 1) {
      score += 12
      ranges[ranges.length - 1][1] = found + 1
    } else {
      ranges.push([found, found + 1])
      if (found === 0) score += 24
      else if (/[\s\-_/.:]/.test(haystack[found - 1])) score += 18
      score -= Math.min(found - index, 12)
    }
    previous = found
    index = found + 1
  }
  return { score, ranges }
}

export function filterCommands(commands: readonly Command[], rawQuery: string, locale: Locale): CommandMatch[] {
  const actionsOnly = rawQuery.startsWith('>')
  const query = (actionsOnly ? rawQuery.slice(1) : rawQuery).trim()
  const pool = actionsOnly ? commands.filter(command => command.group === 'action') : commands

  if (!query) {
    return pool.map(command => ({ ...command, score: 0, ranges: [] })).slice(0, 40)
  }

  const matches: CommandMatch[] = []
  for (const command of pool) {
    const onTitle = fuzzyScore(query, command.title)
    if (onTitle) {
      matches.push({ ...command, score: onTitle.score, ranges: onTitle.ranges })
      continue
    }
    const onKeywords = fuzzyScore(query, command.keywords)
    if (onKeywords) matches.push({ ...command, score: onKeywords.score * 0.6, ranges: [] })
  }

  // The tiebreak collates in the app's language, not the OS's, so the order agrees with
  // the alphabet the titles are actually written in.
  return matches.sort((a, b) => b.score - a.score || GROUP_WEIGHT[a.group] - GROUP_WEIGHT[b.group] || a.title.localeCompare(b.title, locale)).slice(0, 40)
}

/** Flattens the tree into request rows carrying a `Collection / Folder` breadcrumb. */
export function flattenRequests(nodes: readonly TreeNode[], trail: string[] = []): { requestId: string; name: string; breadcrumb: string }[] {
  return nodes.flatMap(node =>
    node.type === 'request'
      ? [{ requestId: node.requestId, name: node.name, breadcrumb: trail.join(' / ') }]
      : flattenRequests(node.children, [...trail, node.name]),
  )
}

export function groupResults(
  results: readonly CommandMatch[],
  t: Translate,
): { id: CommandGroup; label: string; items: { item: CommandMatch; index: number }[] }[] {
  const groups = new Map<CommandGroup, { item: CommandMatch; index: number }[]>()
  results.forEach((item, index) => {
    const bucket = groups.get(item.group) ?? []
    bucket.push({ item, index })
    groups.set(item.group, bucket)
  })
  return [...groups.entries()].sort(([a], [b]) => GROUP_WEIGHT[a] - GROUP_WEIGHT[b]).map(([id, items]) => ({ id, label: t(GROUP_LABEL[id]), items }))
}

export const documentKeywords = (doc: RequestDocument, breadcrumb: string): string => `${doc.name} ${doc.method} ${doc.url} ${breadcrumb}`.toLowerCase()
