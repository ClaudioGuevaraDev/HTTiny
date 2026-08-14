import { useCallback, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'

export interface SplitDragOptions {
  axis: 'x' | 'y'
  unit: 'px' | 'percent'
  value: number
  min: number
  max: number
  /** Keyboard increment per arrow press. */
  step: number
  defaultValue: number
  onChange: (next: number) => void
  /** Required for `unit: 'percent'` — the element the percentage is measured against. */
  containerRef?: RefObject<HTMLElement | null>
}

/**
 * Drives both resizers.
 *
 * Two things the previous inline handlers did not do. Pointer capture, so a fast
 * drag that leaves the window keeps tracking instead of silently dropping. And
 * keyboard support: the old handles were mouse-only, which is a straight WCAG 2.1.1
 * failure on a control that determines how much of the app you can see.
 */
export function useSplitDrag({ axis, unit, value, min, max, step, defaultValue, onChange, containerRef }: SplitDragOptions) {
  const clamp = useCallback((next: number) => Math.min(max, Math.max(min, next)), [min, max])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault()
      const handle = event.currentTarget
      handle.setPointerCapture(event.pointerId)
      const start = axis === 'x' ? event.clientX : event.clientY
      const startValue = value
      const extent = unit === 'percent' ? (containerRef?.current?.getBoundingClientRect()[axis === 'x' ? 'width' : 'height'] ?? 1) : 1

      const move = (moveEvent: PointerEvent) => {
        const delta = (axis === 'x' ? moveEvent.clientX : moveEvent.clientY) - start
        onChange(clamp(startValue + (unit === 'percent' ? (delta / extent) * 100 : delta)))
      }
      const stop = () => {
        handle.releasePointerCapture(event.pointerId)
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', stop)
        handle.removeEventListener('pointercancel', stop)
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', stop)
      handle.addEventListener('pointercancel', stop)
    },
    [axis, unit, value, containerRef, onChange, clamp],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
      const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
      if (event.key === back) {
        event.preventDefault()
        onChange(clamp(value - step))
      } else if (event.key === forward) {
        event.preventDefault()
        onChange(clamp(value + step))
      } else if (event.key === 'Home') {
        event.preventDefault()
        onChange(min)
      } else if (event.key === 'End') {
        event.preventDefault()
        onChange(max)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        onChange(defaultValue)
      }
    },
    [axis, value, step, min, max, defaultValue, onChange, clamp],
  )

  const onDoubleClick = useCallback(() => onChange(defaultValue), [defaultValue, onChange])

  return { onPointerDown, onKeyDown, onDoubleClick }
}
