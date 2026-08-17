import { ArrowRight, Link2Off, Lock, Unlock } from 'lucide-react'
import { formatDate, formatDuration } from '../../format'
import { useLocale, useT } from '../../language'
import type { PlainMessageKey } from '../../i18n'
import type { Locale, Phase, RedirectHop, Timings, TlsInfo } from '../../types'

/**
 * Where the time went, as a waterfall.
 *
 * The response has always reported one number — 479 ms — and nothing about which part
 * of it was the lookup, the handshake, the server thinking or the download. Five bars
 * on a shared axis answer that at a glance, which five separate numbers cannot: it is
 * the *offsets* that turn them into a timeline rather than a list.
 */
const PHASES = [
  { key: 'dns', label: 'response.timeline.dns' },
  { key: 'connect', label: 'response.timeline.connect' },
  { key: 'tls', label: 'response.timeline.tls' },
  { key: 'ttfb', label: 'response.timeline.ttfb' },
  { key: 'download', label: 'response.timeline.download' },
] as const satisfies readonly { key: keyof Timings; label: PlainMessageKey }[]

export function TimelinePanel({ timings, tls, redirects, finalUrl }: { timings: Timings; tls: TlsInfo | null; redirects: readonly RedirectHop[]; finalUrl: string }) {
  const { t } = useT()
  const locale = useLocale()

  // The axis is the total, so every bar is to the same scale and a 2 ms phase looks
  // like 2 ms. Guarded against zero: a loopback response can finish inside a
  // millisecond, and dividing by it would put every bar at NaN%.
  const span = Math.max(timings.totalMs, 1)

  return (
    <div className="timeline-panel">
      {/* No toolbar. The total used to sit up there and now closes the column of phase
          times, where it reads as their sum rather than as a separate fact; the reused
          note is already said in full below. What was left would have been an empty
          strip, which is what Cookies just lost. */}
      <div className="timeline-scroller">
        <ol className="timeline-bars">
          {PHASES.map(({ key, label }) => (
            <Bar key={key} label={t(label)} phase={timings[key]} span={span} locale={locale} />
          ))}
        </ol>
        {/* Not an `<li>` of the list above: it is not a phase, and a screen reader
            walking five phases should not find a sixth that is their sum. It shares the
            grid so the number lands under the column it totals. */}
        <p className="timeline-total">
          <span className="timeline-label">{t('response.timeline.total')}</span>
          <span aria-hidden="true" />
          <span className="timeline-value">{formatDuration(timings.totalMs, locale)}</span>
        </p>

        {/* Said rather than drawn as three empty rows. The transport keeps four idle
            connections per host, so this is the ordinary case for a second send to the
            same place — and unexplained blank bars read as lost data, not as speed. */}
        {timings.reused && <p className="response-notice">{t('response.timeline.reused.desc')}</p>}

        {redirects.length > 0 && <Chain hops={redirects} finalUrl={finalUrl} locale={locale} />}
        <Security tls={tls} locale={locale} />
      </div>
    </div>
  )
}

function Bar({ label, phase, span, locale }: { label: string; phase: Phase; span: number; locale: Locale }) {
  const { t } = useT()
  // A phase that did not happen keeps its row rather than vanishing, so the five rows
  // are the same five every time and the eye can compare two responses.
  const absent = phase.ms === 0
  const width = (phase.ms / span) * 100

  return (
    <li className="timeline-row" data-absent={absent ? 'true' : undefined}>
      <span className="timeline-label">{label}</span>
      <span className="timeline-track">
        {!absent && (
          <span
            className="timeline-fill"
            data-phase={label}
            // Inline because they are data, not design: the offset and the width *are*
            // the measurement. A floor of 0.5% keeps a sub-millisecond phase visible
            // instead of collapsing it to nothing.
            style={{ marginInlineStart: `${(phase.at / span) * 100}%`, inlineSize: `${Math.max(width, 0.5)}%` }}
          />
        )}
      </span>
      <span className="timeline-value">{absent ? '—' : formatDuration(phase.ms, locale)}</span>
      <span className="sr-only">{absent ? t('response.timeline.absent') : ''}</span>
    </li>
  )
}

/**
 * The redirects that were followed. Until now they happened in total silence: the app
 * reported where a request ended up and never how it got there.
 */
function Chain({ hops, finalUrl, locale }: { hops: readonly RedirectHop[]; finalUrl: string; locale: Locale }) {
  const { t, plural } = useT()

  return (
    <section className="timeline-section">
      <h3 className="timeline-heading">{plural('response.timeline.redirects', hops.length)}</h3>
      <ol className="timeline-hops">
        {hops.map((hop, index) => (
          <li key={index} className="timeline-hop">
            <span className="timeline-status" data-bucket="3xx">
              {hop.status}
            </span>
            {/* The method is shown because a 302 rewrites a POST into a GET, and that
                surprise is most of why a chain is worth reading. */}
            <span className="timeline-method">{hop.method}</span>
            <code className="timeline-url" title={hop.url}>
              {hop.url}
            </code>
            <ArrowRight size={11} aria-hidden="true" className="timeline-arrow" />
            <code className="timeline-url" title={hop.location}>
              {hop.location}
            </code>
            <span className="timeline-value">{formatDuration(hop.ms, locale)}</span>
          </li>
        ))}
        <li className="timeline-hop" data-final="true">
          <span className="timeline-status">{t('response.timeline.final')}</span>
          <code className="timeline-url" title={finalUrl}>
            {finalUrl}
          </code>
        </li>
      </ol>
    </section>
  )
}

/**
 * The connection itself. Null for `http://`, which is worth saying out loud rather than
 * leaving as an absent section — "this went over plaintext" is a finding.
 */
function Security({ tls, locale }: { tls: TlsInfo | null; locale: Locale }) {
  const { t } = useT()

  if (!tls) {
    return (
      <section className="timeline-section">
        <h3 className="timeline-heading">{t('response.timeline.security')}</h3>
        <p className="timeline-plaintext">
          <Unlock size={12} aria-hidden="true" />
          {t('response.timeline.noTls')}
        </p>
      </section>
    )
  }

  // Protocol tokens throughout — TLS 1.3, TLS_AES_128_GCM_SHA256, h2 — so only the row
  // labels are translated, the same rule the format badges follow.
  const rows: [PlainMessageKey, string][] = [
    ['response.timeline.tlsVersion', tls.version],
    ['response.timeline.cipher', tls.cipherSuite],
    ['response.timeline.alpn', tls.alpn || '—'],
    ['response.timeline.subject', tls.subject || '—'],
    ['response.timeline.issuer', tls.issuer || '—'],
    ['response.timeline.validUntil', tls.notAfter ? formatDate(tls.notAfter, locale) : '—'],
  ]

  return (
    <section className="timeline-section">
      <h3 className="timeline-heading">
        <Lock size={12} aria-hidden="true" />
        {t('response.timeline.security')}
        {tls.resumed && <span className="timeline-chip">{t('response.timeline.resumed')}</span>}
      </h3>
      <dl className="timeline-facts">
        {rows.map(([label, value]) => (
          <div key={label} className="timeline-fact">
            <dt>{t(label)}</dt>
            <dd>
              <code>{value}</code>
            </dd>
          </div>
        ))}
      </dl>
      {tls.dnsNames.length > 0 && (
        <p className="timeline-names" title={tls.dnsNames.join('\n')}>
          <Link2Off size={11} aria-hidden="true" />
          {t('response.timeline.covers', { names: tls.dnsNames.slice(0, 4).join(', ') })}
          {tls.dnsNames.length > 4 && t('response.timeline.andMore', { count: tls.dnsNames.length - 4 })}
        </p>
      )}
    </section>
  )
}
