/**
 * Presentation helpers for the collection rail.
 *
 * Kept out of `CollectionRail.tsx` because a module that exports both components and
 * plain values breaks React Fast Refresh — and because these are pure functions with
 * no React in them, which is where the rest of the codebase puts that sort of thing.
 */

/** Ties each rail tab to the panel it labels, for `aria-labelledby`. */
export const collectionTabId = (id: string) => `collection-tab-${id}`

export const COLLECTION_PANEL_ID = 'collection-panel'

/** How many hues exist in `theme.css`; `hueOf` returns 1…HUE_COUNT. */
const HUE_COUNT = 8

/**
 * Up to two letters: the initials of the first two words, or the first two letters
 * of a single word. `Array.from` rather than `slice`, so a name starting with an
 * emoji or an astral character is not cut in half through a surrogate pair.
 */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
  if (!words.length) return '?'
  const letters = words.length > 1 ? words.slice(0, 2).map(word => Array.from(word)[0]) : Array.from(words[0]).slice(0, 2)
  return letters.join('').toUpperCase()
}

/**
 * Which of the collection hues a collection gets.
 *
 * Hashed from the **id**, not the name: ids never change, so renaming a collection
 * does not swap its colour out from under you — the colour stays a stable handle for
 * "that one". A rolling hash is enough; the only requirements are that it is
 * deterministic and spreads reasonably.
 */
export function hueOf(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return (hash % HUE_COUNT) + 1
}
