import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * Arrow-key movement inside a composite widget — a tab strip or a radio group.
 *
 * The WAI-ARIA patterns for both say the same thing: the composite is a *single* tab
 * stop, and the arrow keys move between its items. Tab strips in this app were plain
 * rows of buttons, so tabbing through the request panel meant four stops for Params,
 * Headers, Body and Auth before reaching any of their contents.
 *
 * Focus is found by querying the DOM rather than tracked in state. The items are always
 * rendered together and always in visual order, so the DOM already is the source of
 * truth; mirroring it into React state would just be a second thing to keep in sync.
 */
export function useRovingFocus(selector: string, orientation: 'horizontal' | 'vertical' = 'horizontal') {
  const back = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
  const forward = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown'

  return useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (![back, forward, 'Home', 'End'].includes(event.key)) return
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)]
      if (items.length === 0) return
      const current = items.indexOf(document.activeElement as HTMLElement)
      if (current === -1) return

      event.preventDefault()
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : // Wrapping, as both patterns specify: End then → returns to the first item.
              (current + (event.key === forward ? 1 : -1) + items.length) % items.length
      items[next].focus()
    },
    [selector, back, forward],
  )
}
