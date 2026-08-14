import type { ReactNode } from 'react'
import { formatShortcut } from '../shortcuts'

export type PlaceholderTone = 'neutral' | 'accent' | 'danger'

/**
 * Shared scaffold for the four dead-end states — no request open, nothing sent,
 * loading, failed. Every one of them now carries a primary action, because the
 * previous versions described the situation without offering a way out of it.
 */
export function Placeholder({
  tone = 'neutral',
  icon,
  title,
  description,
  children,
}: {
  tone?: PlaceholderTone
  icon: ReactNode
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="placeholder" data-tone={tone}>
      <div className="placeholder-icon" aria-hidden="true">
        {icon}
      </div>
      {/* h2, not h3: the only h1 is the app name in the sidebar, and skipping a level
          leaves a hole in the outline. */}
      <h2 className="placeholder-title">{title}</h2>
      <p className="placeholder-body">{description}</p>
      {children && <div className="placeholder-actions">{children}</div>}
    </div>
  )
}

export function PlaceholderAction({
  variant = 'primary',
  shortcut,
  onClick,
  children,
}: {
  variant?: 'primary' | 'secondary'
  shortcut?: readonly string[]
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" className={`placeholder-action action-${variant}`} onClick={onClick}>
      <span>{children}</span>
      {shortcut && <Shortcut keys={shortcut} />}
    </button>
  )
}

/**
 * `aria-hidden` because the hint duplicates information already carried by the
 * control's accessible name; leaving it exposed makes a screen reader read
 * "Send request Ctrl Enter" as one run-on string.
 */
export function Shortcut({ keys }: { keys: readonly string[] }) {
  return (
    <span className="shortcut" aria-hidden="true">
      {formatShortcut(keys).map(key => (
        <kbd key={key}>{key}</kbd>
      ))}
    </span>
  )
}

const SKELETON_WIDTHS = [88, 64, 76, 42, 81, 58, 70, 35]

/** Shape-of-the-answer placeholder for the loading state, in place of a bare spinner. */
export function SkeletonLines({ count }: { count: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="skeleton-line" style={{ width: `${SKELETON_WIDTHS[index % SKELETON_WIDTHS.length]}%` }} />
      ))}
    </div>
  )
}
