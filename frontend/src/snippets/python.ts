import { double, multiline, pythonTriple } from './quote'
import { bodyOf, seconds, snippetHeaders, type Wire } from './types'

/** A triple-quoted body when it spans lines, an escaped one when it does not. */
const body = (wire: Wire): string => {
  const text = bodyOf(wire)
  return multiline(text) ? pythonTriple(text) : double(text)
}

const preamble = (wire: Wire, module: string): string[] => {
  const lines = [`import ${module}`, '', `url = ${double(wire.url)}`]
  const headers = snippetHeaders(wire)
  if (headers.length) {
    lines.push('headers = {', ...headers.map(header => `    ${double(header.key)}: ${double(header.value)},`), '}')
  }
  if (wire.hasBody) lines.push(`payload = ${body(wire)}`)
  return [...lines, '']
}

/** The keyword arguments both libraries share, given what this request actually has. */
const common = (wire: Wire, bodyArg: string): string[] => {
  const args = [`${double(wire.method)}`, 'url']
  if (snippetHeaders(wire).length) args.push('headers=headers')
  if (wire.hasBody) args.push(`${bodyArg}=payload`)
  return args
}

/**
 * requests.
 *
 * `requests.request` takes the verb as data, which avoids a branch per method here and
 * keeps working for one it has no helper for. Redirects are followed by default and
 * uncapped, so only the timeout needs stating.
 */
export const requests = (wire: Wire): string =>
  [
    ...preamble(wire, 'requests'),
    `response = requests.request(${[...common(wire, 'data'), `timeout=${seconds(wire)}`].join(', ')})`,
    '',
    'print(response.text)',
  ].join('\n')

/**
 * httpx.
 *
 * `follow_redirects=True` is not optional decoration: httpx is the one library here that
 * does **not** follow redirects by default, so without it the snippet reports a 302 where
 * the app reported the page.
 *
 * `content=` rather than `data=` for a raw payload — in httpx, `data=` means a form.
 */
export const httpx = (wire: Wire): string =>
  [
    ...preamble(wire, 'httpx'),
    `response = httpx.request(${[...common(wire, 'content'), `timeout=${seconds(wire)}.0`, 'follow_redirects=True'].join(', ')})`,
    '',
    'print(response.text)',
  ].join('\n')
