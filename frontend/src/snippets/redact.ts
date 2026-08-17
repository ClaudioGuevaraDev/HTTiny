import type { Wire } from './types'

/**
 * Header names whose value is a credential, and the environment variable each is
 * replaced by.
 *
 * A list rather than a heuristic, because a wrong guess in either direction is bad: a
 * missed header leaks a key into a pasted snippet, and an over-eager match redacts an
 * `X-Request-Id` for nothing. These are the names that carry secrets in practice.
 *
 * `authorization` maps to `AUTH_TOKEN` rather than to its own name because that is what
 * the value is — the header is the envelope, `Bearer …` is the credential.
 *
 * The map is keyed lowercase and looked up that way: Go canonicalises header names on
 * the way out (`api-key` comes back as `Api-Key`), so matching the name as typed would
 * miss.
 */
const SECRET_HEADERS: Record<string, string> = {
  authorization: 'AUTH_TOKEN',
  'proxy-authorization': 'PROXY_AUTH_TOKEN',
  cookie: 'COOKIE',
  'api-key': 'API_KEY',
  'x-api-key': 'API_KEY',
  'x-auth-token': 'AUTH_TOKEN',
  'x-access-token': 'ACCESS_TOKEN',
  'x-csrf-token': 'CSRF_TOKEN',
}

/**
 * Replaces credential values with an environment-variable placeholder.
 *
 * A transform over the resolved request rather than an option threaded through every
 * generator: one place decides what a secret is, and no generator can forget to ask.
 *
 * The placeholder is written in shell form (`$API_KEY`) in every target, and it is a
 * *marker*, not a live read — including in the shell targets, where the surrounding single
 * quotes are exactly what stops `$API_KEY` from expanding. That is deliberate: this toggle
 * exists so a snippet can be pasted into a ticket, and a snippet that quietly picks up
 * whatever is in the environment would be a different request from the one on screen.
 * Emitting a real `$env:X` / `process.env.X` / `os.environ[…]` per language would mean a
 * placeholder concept in all thirteen generators, to make a *redacted* snippet runnable —
 * which is not what it is for.
 *
 * The body is deliberately untouched. A password can appear in a JSON payload, but
 * finding it would mean guessing at the shape of someone else's schema.
 */
export const redactWire = (wire: Wire): Wire => ({
  ...wire,
  headers: wire.headers.map(header => {
    const variable = SECRET_HEADERS[header.key.toLowerCase()]
    return variable ? { ...header, value: `$${variable}` } : header
  }),
})
