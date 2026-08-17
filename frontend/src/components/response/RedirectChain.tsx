import { ArrowRight } from 'lucide-react'
import { formatDuration } from '../../format'
import { useT } from '../../language'
import type { Locale, RedirectHop } from '../../types'

/**
 * How the chain ended, which decides its last row.
 *
 * The three cases are not cosmetic: the same URL means something different in each. On
 * success the request landed somewhere and `finalUrl` is that place. On the other two
 * there is no final response at all, and the row shows the last hop's `Location` — which
 * was *received but refused* when the limit was hit, and *requested but never answered*
 * when something else went wrong afterwards. Calling both "final" would be a lie in two
 * directions.
 */
export type ChainEnd = { kind: 'final'; url: string } | { kind: 'notFollowed' } | { kind: 'unreached' }

/**
 * The redirects that were followed. They happen in total silence otherwise: the app
 * reports where a request ended up and never how it got there.
 *
 * Its own file rather than a local of `TimelinePanel`, because the failure state needs it
 * too — a chain abandoned for being too long is the case where it is most worth reading
 * and the only one where there is no Timeline tab to put it in.
 */
export function RedirectChain({ hops, end, locale }: { hops: readonly RedirectHop[]; end: ChainEnd; locale: Locale }) {
  const { t, plural } = useT()

  // Where the chain was pointing when it stopped. Derived here rather than passed in, so
  // the failure branch does not have to know that the answer lives on the last hop.
  const destination = end.kind === 'final' ? end.url : (hops[hops.length - 1]?.location ?? '')
  const label = end.kind === 'final' ? t('response.timeline.final') : end.kind === 'notFollowed' ? t('response.timeline.notFollowed') : t('response.timeline.unreached')

  return (
    <section className="timeline-section">
      {/* Accurate in all three cases: ten followed are ten followed, and the hop that
          broke the limit is deliberately never recorded. */}
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
        <li className="timeline-hop" data-final="true" data-end={end.kind}>
          <span className="timeline-status">{label}</span>
          <code className="timeline-url" title={destination}>
            {destination}
          </code>
        </li>
      </ol>
    </section>
  )
}
