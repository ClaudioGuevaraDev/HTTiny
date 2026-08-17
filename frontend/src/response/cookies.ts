import type { KeyValueRow } from '../types'

/**
 * A reader for `Set-Cookie`, hand-rolled for the same reason `csv.ts` and `sse.ts` are:
 * the whole grammar is a split and a table of attribute names, and a dependency would
 * be larger than the thing it replaces.
 *
 * What it is not is a cookie jar. HTTiny stores nothing and replays nothing — there is
 * no `http.CookieJar` on the Go client, deliberately — so this describes exactly one
 * response's headers and never accumulates across requests.
 *
 * It parses leniently. RFC 6265 says a cookie with no `=` in its first segment should
 * be ignored; a tool you point at a misbehaving server should show it instead, which is
 * why nothing here drops a row. Every cookie keeps its original header text so the row
 * can offer it whole.
 */

/** Which of the three ways a cookie can end. `at` is epoch milliseconds. */
export type Expiry = { kind: 'session' } | { kind: 'at'; at: number }

export interface Cookie {
  /** Stable across re-sends: the name plus the row it came from, since names repeat. */
  id: string
  name: string
  value: string
  domain: string
  path: string
  expiry: Expiry
  secure: boolean
  httpOnly: boolean
  /** `Strict` | `Lax` | `None` as the server spelled it, or empty when absent. */
  sameSite: string
  /**
   * The response is deleting this cookie rather than setting it — an empty value with an
   * expiry already in the past, which is the canonical way to do it. Worth its own field
   * because "the server just logged me out" is a thing you come to a response viewer to
   * find out, and it looks identical to an ordinary row otherwise.
   */
  deletion: boolean
  /** The whole `Set-Cookie` value, for the attributes that have no column of their own. */
  raw: string
}

/** Go canonicalises header names, but `redact.ts` documents why that is not leant on. */
const isSetCookie = (name: string): boolean => name.toLowerCase() === 'set-cookie'

/**
 * Splits one `Set-Cookie` value.
 *
 * The name/value pair is cut at the **first** `=` and no other. Cookie values carry `=`
 * constantly — base64 padding, JWT segments — and splitting on every one of them is the
 * single most common way to get this wrong.
 */
function parseOne(raw: string, id: string, now: number): Cookie {
  const [pair = '', ...attributes] = raw.split(';')
  const equals = pair.indexOf('=')
  const name = (equals === -1 ? pair : pair.slice(0, equals)).trim()
  const value = equals === -1 ? '' : pair.slice(equals + 1).trim()

  const cookie: Cookie = {
    id,
    name,
    value,
    domain: '',
    path: '',
    expiry: { kind: 'session' },
    secure: false,
    httpOnly: false,
    sameSite: '',
    deletion: false,
    raw,
  }

  let expires: number | null = null
  let maxAge: number | null = null

  for (const attribute of attributes) {
    const cut = attribute.indexOf('=')
    const key = (cut === -1 ? attribute : attribute.slice(0, cut)).trim().toLowerCase()
    const attrValue = cut === -1 ? '' : attribute.slice(cut + 1).trim()

    switch (key) {
      case 'domain':
        cookie.domain = attrValue
        break
      case 'path':
        cookie.path = attrValue
        break
      case 'secure':
        cookie.secure = true
        break
      case 'httponly':
        cookie.httpOnly = true
        break
      case 'samesite':
        cookie.sameSite = attrValue
        break
      case 'expires': {
        // `Date.parse` reads the IMF-fixdate form the spec mandates, and the two obsolete
        // forms servers still send. An unparseable date is not a broken row — the
        // attribute is dropped and the cookie reads as a session one, which is what a
        // browser does with it too.
        const parsed = Date.parse(attrValue)
        if (!Number.isNaN(parsed)) expires = parsed
        break
      }
      case 'max-age': {
        const seconds = Number.parseInt(attrValue, 10)
        if (!Number.isNaN(seconds)) maxAge = seconds
        break
      }
      default:
        // Partitioned, Priority, and whatever a server invents next. They survive in
        // `raw`, which is what the row offers on hover.
        break
    }
  }

  // Max-Age wins over Expires when both are present (RFC 6265 §5.3). That precedence is
  // the one people invert when reading a Set-Cookie by eye, which is half the reason
  // this column is worth having.
  if (maxAge !== null) cookie.expiry = { kind: 'at', at: now + maxAge * 1000 }
  else if (expires !== null) cookie.expiry = { kind: 'at', at: expires }

  cookie.deletion = value === '' && cookie.expiry.kind === 'at' && cookie.expiry.at <= now

  return cookie
}

/**
 * Every cookie the response set, sorted by name.
 *
 * The sort is not cosmetic. `flattenHeaders` on the Go side iterates a map, so header
 * rows arrive in an order that differs between sends of the same request — a table that
 * reshuffled every time you pressed Send would be unusable for comparing two responses.
 * Sorting here rather than in Go is deliberate: the eventual Raw panel needs the
 * headers in the order and casing the server sent them.
 *
 * `now` is a parameter rather than a `Date.now()` inside, so a component memoising this
 * gets a stable result instead of one that drifts on every render.
 */
export function parseCookies(headers: readonly KeyValueRow[], now: number): Cookie[] {
  return headers
    .filter(header => isSetCookie(header.key))
    .map(header => parseOne(header.value, header.id, now))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}
