import type { ReactNode } from 'react'
import { ArrowRightLeft, Ban, CircleCheck, CircleDashed, LoaderCircle, OctagonAlert, TriangleAlert } from 'lucide-react'
import { formatBytes, formatDuration, statusBucket } from '../format'
import type { ResponseSnapshot } from '../types'

const BUCKET_ICON = {
  '2xx': CircleCheck,
  '3xx': ArrowRightLeft,
  '4xx': TriangleAlert,
  '5xx': OctagonAlert,
} as const

/**
 * The payoff moment of the app, which used to be 10px of grey text in the corner of
 * a bar whose main content was the word "Response".
 *
 * Rendered in all four states so the panel chrome keeps a constant height.
 */
export function ResponseStatus({ response, elapsed, children }: { response: ResponseSnapshot; elapsed: number; children?: ReactNode }) {
  return (
    <header className="response-status" data-state={response.state}>
      <StatusPill response={response} />
      <dl className="status-metrics">
        {response.state === 'success' && (
          <>
            <Metric label="Time" value={formatDuration(response.time)} />
            <Metric label="Size" value={formatBytes(response.sizeBytes)} />
            <Metric label="Headers" value={String(response.headers.length)} />
          </>
        )}
        {response.state === 'loading' && <Metric label="Elapsed" value={formatDuration(elapsed)} />}
        {response.state === 'error' && <Metric label="Code" value={response.code} />}
      </dl>
      {children && <div className="status-actions">{children}</div>}
      <Announcement response={response} />
    </header>
  )
}

/**
 * The live region is a separate, invisible node carrying *settled* text only.
 *
 * `role="status"` used to sit on the header itself, which contains the Elapsed metric —
 * and that re-renders every 100ms while a request is in flight, so a screen reader
 * re-read the entire bar, buttons included, ten times a second. Announcing only what
 * changed on a state boundary means one utterance per request instead of hundreds.
 */
function Announcement({ response }: { response: ResponseSnapshot }) {
  const text =
    response.state === 'loading'
      ? 'Sending…'
      : response.state === 'success'
        ? `${response.status} ${response.statusText} · ${formatDuration(response.time)} · ${formatBytes(response.sizeBytes)}`
        : response.state === 'error'
          ? `Request failed: ${response.message}. ${response.detail}`
          : ''
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {text}
    </p>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <dt className="metric-label">{label}</dt>
      <dd className="metric-value">{value}</dd>
    </div>
  )
}

/** Each variant carries a distinct glyph *and* literal text, so nothing here is
 * conveyed by colour alone. */
function StatusPill({ response }: { response: ResponseSnapshot }) {
  if (response.state === 'success') {
    const bucket = statusBucket(response.status)
    const Icon = BUCKET_ICON[bucket]
    return (
      <p className="status-pill" data-bucket={bucket}>
        <Icon size={13} className="status-glyph" aria-hidden="true" />
        <span className="status-code">{response.status}</span>
        <span className="status-text">{response.statusText}</span>
      </p>
    )
  }
  if (response.state === 'loading') {
    return (
      <p className="status-pill" data-bucket="pending">
        <LoaderCircle size={13} className="status-glyph" aria-hidden="true" />
        <span className="status-text">Sending…</span>
      </p>
    )
  }
  if (response.state === 'error') {
    return (
      <p className="status-pill" data-bucket="failed">
        <Ban size={13} className="status-glyph" aria-hidden="true" />
        <span className="status-code">Failed</span>
        <span className="status-text">{response.message}</span>
      </p>
    )
  }
  return (
    <p className="status-pill" data-bucket="idle">
      <CircleDashed size={13} className="status-glyph" aria-hidden="true" />
      <span className="status-text">No response yet</span>
    </p>
  )
}
