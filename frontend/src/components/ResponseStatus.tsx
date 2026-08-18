import type { ReactNode } from 'react'
import { ArrowRightLeft, Ban, CircleCheck, CircleDashed, LoaderCircle, OctagonAlert, TriangleAlert } from 'lucide-react'
import { errorCopy } from '../errors'
import { formatBytes, formatDuration, statusBucket } from '../format'
import { useLocale, useT } from '../language'
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
  const { t } = useT()
  const locale = useLocale()

  return (
    <header className="response-status" data-state={response.state}>
      <StatusPill response={response} />
      <dl className="status-metrics">
        {response.state === 'success' && (
          <>
            <Metric label={t('response.metric.time')} value={formatDuration(response.time, locale)} />
            <Metric label={t('response.metric.size')} value={formatBytes(response.sizeBytes, locale)} />
          </>
        )}
        {response.state === 'loading' && <Metric label={t('response.metric.elapsed')} value={formatDuration(elapsed, locale)} />}
        {response.state === 'error' && <Metric label={t('response.metric.code')} value={response.code} />}
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
  const { t } = useT()
  const locale = useLocale()

  let text = ''
  if (response.state === 'loading') {
    text = t('response.pill.sending')
  } else if (response.state === 'success') {
    // The status line keeps its raw parts: the code and the RFC reason phrase are
    // protocol, and the units are symbols.
    text = `${response.status} ${response.statusText} · ${formatDuration(response.time, locale)} · ${formatBytes(response.sizeBytes, locale)}`
  } else if (response.state === 'error') {
    const failure = errorCopy(t, response.code, response.detail)
    text = t('response.announce.error', { title: failure.title, detail: failure.detail })
  }

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
  const { t } = useT()

  if (response.state === 'success') {
    const bucket = statusBucket(response.status)
    const Icon = BUCKET_ICON[bucket]
    return (
      <p className="status-pill" data-bucket={bucket}>
        <Icon size={13} className="status-glyph" aria-hidden="true" />
        <span className="status-code">{response.status}</span>
        {/* `statusText` is `http.StatusText` from Go — an RFC reason phrase sitting
            beside its own numeric code, so it stays in English like every other
            protocol token in this app. */}
        <span className="status-text">{response.statusText}</span>
      </p>
    )
  }
  if (response.state === 'loading') {
    return (
      <p className="status-pill" data-bucket="pending">
        <LoaderCircle size={13} className="status-glyph" aria-hidden="true" />
        <span className="status-text">{t('response.pill.sending')}</span>
      </p>
    )
  }
  if (response.state === 'error') {
    return (
      <p className="status-pill" data-bucket="failed">
        <Ban size={13} className="status-glyph" aria-hidden="true" />
        <span className="status-code">{t('response.pill.failed')}</span>
        {/* The headline only — the pill is narrow, and the diagnostic belongs to the
            placeholder below it. */}
        <span className="status-text">{errorCopy(t, response.code).title}</span>
      </p>
    )
  }
  return (
    <p className="status-pill" data-bucket="idle">
      <CircleDashed size={13} className="status-glyph" aria-hidden="true" />
      <span className="status-text">{t('response.pill.idle')}</span>
    </p>
  )
}
