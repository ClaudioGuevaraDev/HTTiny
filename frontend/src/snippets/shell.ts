import { posix, powershell, windowsArg } from './quote'
import { bodyOf, seconds, snippetHeaders, type Wire } from './types'

/**
 * The shell targets.
 *
 * All four aim at the same thing: paste it, run it, get what the app got. That is why
 * they carry the redirect and timeout policy explicitly — a snippet that stops at the
 * first 302 while the app followed ten of them is not the same request.
 */

/**
 * How curl should be told the method.
 *
 * GET with no body is its default, so it needs saying only when something else is true.
 * HEAD is the exception that has to be `--head`: with `-X HEAD` curl sends the right verb
 * but still waits for a response body, and hangs until the timeout — a snippet that
 * appears to be broken while being technically correct.
 */
const methodFlag = (wire: Wire): string[] => {
  if (wire.method === 'HEAD') return ['--head']
  return wire.method !== 'GET' || wire.hasBody ? [`-X ${wire.method}`] : []
}

/**
 * The curl options that describe *this* URL, as opposed to the policy ones below.
 *
 * `--globoff` is not defensive: curl reads `[` and `]` in a URL as its own range syntax,
 * so an Odoo domain filter — `?domain=[('state', '=', 'sale')]`, the request that started
 * all of this — makes curl refuse to run at all with "bad range specification". Found by
 * executing the generated snippet rather than reading it.
 *
 * `--path-as-is` keeps curl from resolving `/../` and `/./` in the path. Go sends the path
 * exactly as written, so without this the snippet would quietly request a different one.
 *
 * Both are conditional. They are noise on the ordinary URL, and a generated snippet earns
 * trust by having nothing in it that is not doing something.
 */
const urlFlags = (wire: Wire): string[] => {
  const flags: string[] = []
  if (/[[\]{}]/.test(wire.url)) flags.push('--globoff')
  if (/\/\.\.?(\/|$)/.test(wire.target)) flags.push('--path-as-is')
  return flags
}

/** The client behaviour a snippet has to opt into to match what the app does. */
const policyFlags = (wire: Wire, seconds: number): string[] => [
  ...(wire.policy.gzip ? ['--compressed'] : []),
  ...(wire.policy.maxRedirects > 0 ? [`--location --max-redirs ${wire.policy.maxRedirects}`] : []),
  `--max-time ${seconds}`,
]

/**
 * curl for a POSIX shell.
 *
 * `--data-raw` rather than `-d`: `-d @foo` reads a *file*, so a body that happens to
 * start with an `@` would be silently replaced by whatever that path holds. `--data-raw`
 * turns that off and sends the string.
 *
 * `--compressed` stands in for the `Accept-Encoding` the transport adds. Sending the
 * header by hand instead would leave curl printing gzip bytes, which is the same trap
 * `decompress` exists to handle in Go.
 */
export const curl = (wire: Wire): string => {
  const parts = [`curl ${posix(wire.url)}`, ...methodFlag(wire)]
  for (const header of snippetHeaders(wire)) parts.push(`-H ${posix(`${header.key}: ${header.value}`)}`)
  if (wire.hasBody) parts.push(`--data-raw ${posix(bodyOf(wire))}`)
  parts.push(...urlFlags(wire), ...policyFlags(wire, seconds(wire)))
  return parts.join(' \\\n  ')
}

/**
 * curl for PowerShell — and it is a different snippet, not the same one with different
 * line breaks.
 *
 * `curl.exe`, spelled out, because in Windows PowerShell `curl` is an **alias for
 * `Invoke-WebRequest`**, which does not understand a single one of these flags. The
 * continuation character is a backtick, and a literal single quote is doubled rather
 * than backslash-escaped.
 *
 * Every argument goes through `windowsArg` as well as `powershell`: two layers, because
 * two things parse it. PowerShell reads the single-quoted string, then hands it to a
 * native executable *without* escaping the quotes inside it — see `quote.windowsArg` for
 * what that silently does to a JSON body, and for why this is not paranoia.
 */
const psArg = (value: string): string => powershell(windowsArg(value))

export const curlPowerShell = (wire: Wire): string => {
  const parts = [`curl.exe ${psArg(wire.url)}`, ...methodFlag(wire)]
  for (const header of snippetHeaders(wire)) parts.push(`-H ${psArg(`${header.key}: ${header.value}`)}`)
  if (wire.hasBody) parts.push(`--data-raw ${psArg(bodyOf(wire))}`)
  parts.push(...urlFlags(wire), ...policyFlags(wire, seconds(wire)))
  return parts.join(' `\n  ')
}

/**
 * HTTPie.
 *
 * Its headers are bare `Name:value` arguments, and a raw body arrives on stdin — hence
 * the `echo` prefix, which is also why the body is quoted for the shell and not for
 * HTTPie. `--follow` is not the default, so it is spelled out to match the app.
 */
export const httpie = (wire: Wire): string => {
  const parts = [`http ${wire.method} ${posix(wire.url)}`]
  for (const header of snippetHeaders(wire)) parts.push(posix(`${header.key}:${header.value}`))
  if (wire.policy.maxRedirects > 0) parts.push(`--follow --max-redirects=${wire.policy.maxRedirects}`)
  parts.push(`--timeout=${seconds(wire)}`)
  const command = parts.join(' \\\n  ')
  return wire.hasBody ? `echo ${posix(bodyOf(wire))} \\\n  | ${command}` : command
}

/**
 * wget.
 *
 * `-qO-` writes the body to stdout and drops the progress meter, which is the closest
 * thing to what the response panel shows. `--method` is what lets the same shape serve
 * every verb, and it is also what `--body-data` requires.
 */
export const wget = (wire: Wire): string => {
  const parts = [`wget -qO- ${posix(wire.url)}`, `--method=${wire.method}`]
  for (const header of snippetHeaders(wire)) parts.push(`--header=${posix(`${header.key}: ${header.value}`)}`)
  if (wire.hasBody) parts.push(`--body-data=${posix(bodyOf(wire))}`)
  parts.push(`--max-redirect=${wire.policy.maxRedirects}`, `--timeout=${seconds(wire)}`)
  return parts.join(' \\\n  ')
}
