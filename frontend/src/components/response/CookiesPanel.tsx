import type { ReactNode, RefObject } from 'react'
import { CookieIcon, Trash2 } from 'lucide-react'
import { formatDate, formatRelative } from '../../format'
import { useLocale, useT } from '../../language'
import type { Cookie } from '../../response/cookies'
import { Placeholder } from '../Placeholder'

/**
 * The cookies a response set, one row each.
 *
 * Everything here is already in the Headers tab — as one long `Set-Cookie` string per
 * cookie, which is exactly the problem. Answering "is this Secure", "when does it expire"
 * or "did that response just delete my session" means reading the whole line, and
 * comparing two cookies means reading two.
 *
 * `now` is the moment the response landed, not the current clock. RFC 6265 defines
 * `Max-Age` as a duration from when the cookie was *received*, so that is the only
 * instant it can honestly be resolved against — and reading the clock while rendering
 * would additionally be impure, which the React Compiler rejects.
 */
export function CookiesPanel({
  cookies,
  now,
  currentRow,
  bodyRef,
  highlight,
}: {
  cookies: readonly Cookie[]
  /** When the response landed. `Max-Age` is a duration from receipt, not from now. */
  now: number
  /** Index of the row holding the find bar's current match, or -1. */
  currentRow: number
  bodyRef: RefObject<HTMLTableSectionElement | null>
  /** The viewer's `Highlighted`, passed down so the marking is identical to the headers table. */
  highlight: (text: string) => ReactNode
}) {
  const { t, plural } = useT()
  const locale = useLocale()

  if (cookies.length === 0) {
    return <Placeholder icon={<CookieIcon size={20} />} title={t('response.cookies.none.title')} description={t('response.cookies.none.desc')} />
  }

  return (
    <div className="cookies-panel">
      <div className="media-toolbar">
        <p className="media-facts">{plural('response.cookies.count', cookies.length)}</p>
      </div>
      <div className="cookies-scroller">
        <table className="cookies-grid">
          <caption className="sr-only">{t('response.cookies.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('response.cookies.name')}</th>
              <th scope="col">{t('response.cookies.value')}</th>
              <th scope="col">{t('response.cookies.scope')}</th>
              <th scope="col">{t('response.cookies.expires')}</th>
              <th scope="col">{t('response.cookies.flags')}</th>
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {cookies.map((cookie, index) => (
              /* The whole header on hover: `Partitioned`, `Priority` and anything a server
                 invents have no column, and dropping them silently would make the table a
                 worse reading of the response than the string it replaces. */
              <tr key={cookie.id} title={cookie.raw} data-current={currentRow === index ? 'true' : undefined} data-deletion={cookie.deletion ? 'true' : undefined}>
                <th scope="row" className="cookie-name">
                  {cookie.deletion && <Trash2 size={11} aria-hidden="true" />}
                  {highlight(cookie.name)}
                </th>
                <td className="cookie-value">{highlight(cookie.value)}</td>
                <td>{highlight(scopeOf(cookie))}</td>
                <td>
                  <Expiry cookie={cookie} now={now} locale={locale} />
                </td>
                <td>
                  <Flags cookie={cookie} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Domain and path in one cell, as the pair they are read as.
 *
 * An absent `Domain` is not the same as an empty one: it means host-only, so the cookie
 * belongs to the exact host that sent it. That distinction is real, but naming the host
 * here would mean inventing a value the header did not carry — so the cell shows what
 * arrived and the tooltip on the row shows the rest.
 */
const scopeOf = (cookie: Cookie): string => [cookie.domain, cookie.path].filter(Boolean).join(' ') || '—'

function Expiry({ cookie, now, locale }: { cookie: Cookie; now: number; locale: 'en' | 'es' }) {
  const { t } = useT()
  if (cookie.expiry.kind === 'session') return <span className="cookie-session">{t('response.cookies.session')}</span>

  const { at } = cookie.expiry
  // Relative, because "in 2 weeks" is the question; the exact instant is one hover away.
  return (
    <span className={at <= now ? 'cookie-expired' : undefined} title={formatDate(at, locale)}>
      {formatRelative(at, now, locale)}
    </span>
  )
}

/**
 * The three flags worth scanning for, as compact marks.
 *
 * Not translated: `Secure`, `HttpOnly` and `SameSite` are the attribute names as they
 * appear in the header, and the same rule the format badges follow — a token, not prose.
 */
function Flags({ cookie }: { cookie: Cookie }) {
  const { t } = useT()
  const marks: string[] = []
  if (cookie.secure) marks.push('Secure')
  if (cookie.httpOnly) marks.push('HttpOnly')
  if (cookie.sameSite) marks.push(`SameSite=${cookie.sameSite}`)

  if (marks.length === 0) return <span className="cookie-noflags">—</span>
  return (
    <span className="cookie-flags">
      {marks.map(mark => (
        <span key={mark} className="cookie-flag" title={t('response.cookies.flag', { flag: mark })}>
          {mark}
        </span>
      ))}
    </span>
  )
}
