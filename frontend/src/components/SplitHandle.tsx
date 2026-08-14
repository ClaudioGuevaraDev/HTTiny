import { useSplitDrag, type SplitDragOptions } from '../useSplitDrag'

/**
 * One component for both resizers. `role="separator"` with `aria-valuenow` is the
 * ARIA pattern for a window splitter, and `tabIndex={0}` is what makes the handle
 * reachable at all — the previous divs were pointer-only.
 */
export function SplitHandle({ label, ...options }: SplitDragOptions & { label: string }) {
  const handlers = useSplitDrag(options)
  return (
    <div
      className="split-handle"
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={options.axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(options.value)}
      aria-valuemin={options.min}
      aria-valuemax={options.max}
      data-axis={options.axis}
      {...handlers}
    >
      <span className="split-grip" aria-hidden="true" />
    </div>
  )
}
