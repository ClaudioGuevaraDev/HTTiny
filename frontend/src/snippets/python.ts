import { double, multiline, pythonTriple } from './quote'
import { bodyOf, fileOf, isTextBody, partsOf, seconds, snippetHeaders, type Wire } from './types'

/** A triple-quoted body when it spans lines, an escaped one when it does not. */
const body = (wire: Wire): string => {
  const text = bodyOf(wire)
  return multiline(text) ? pythonTriple(text) : double(text)
}

/**
 * The multipart arguments, as **lists of tuples** rather than dicts.
 *
 * Both libraries accept either, and the dict form reads better right up to the moment a
 * form repeats a field name — `files={"photo": …, "photo": …}` silently keeps the last
 * one, which is a form the app would have sent with two parts. Repeated names are
 * ordinary in multipart, so the shape that can express them is the one used.
 *
 * A file tuple is `(filename, fileobj, content_type)`. The filename matters: without it
 * the part is named after the path as opened, which is not always the same thing.
 */
const formLines = (wire: Wire): string[] => {
  const parts = partsOf(wire)
  if (!parts.length) return []
  const text = parts.filter(part => part.kind !== 'file')
  const files = parts.filter(part => part.kind === 'file')
  const lines: string[] = []
  if (text.length) lines.push('data = [', ...text.map(part => `    (${double(part.name)}, ${double(part.value)}),`), ']')
  if (files.length) {
    lines.push(
      'files = [',
      ...files.map(part => `    (${double(part.name)}, (${double(part.filename)}, open(${double(part.path)}, "rb"), ${double(part.contentType)})),`),
      ']',
    )
  }
  return lines
}

const preamble = (wire: Wire, module: string): string[] => {
  const lines = [`import ${module}`, '', `url = ${double(wire.url)}`]
  const headers = snippetHeaders(wire)
  if (headers.length) {
    lines.push('headers = {', ...headers.map(header => `    ${double(header.key)}: ${double(header.value)},`), '}')
  }
  lines.push(...formLines(wire))
  if (isTextBody(wire)) lines.push(`payload = ${body(wire)}`)
  const file = fileOf(wire)
  if (file) lines.push(`payload = open(${double(file.path)}, "rb").read()`)
  return [...lines, '']
}

/**
 * The keyword arguments both libraries share, given what this request actually has.
 *
 * `bodyArg` differs between the two only for a raw payload — `data=` in requests,
 * `content=` in httpx, where `data=` means a form. For a multipart body both spell it
 * `data=` and `files=`, so those two need no parameter.
 */
const common = (wire: Wire, bodyArg: string): string[] => {
  const args = [`${double(wire.method)}`, 'url']
  if (snippetHeaders(wire).length) args.push('headers=headers')
  const parts = partsOf(wire)
  if (parts.length) {
    if (parts.some(part => part.kind !== 'file')) args.push('data=data')
    if (parts.some(part => part.kind === 'file')) args.push('files=files')
  } else if (wire.hasBody) {
    args.push(`${bodyArg}=payload`)
  }
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
