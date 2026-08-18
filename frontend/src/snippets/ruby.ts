import { double, multiline, rubyHeredoc } from './quote'
import { bodyOf, fileOf, isTextBody, partsOf, seconds, snippetHeaders, type Wire } from './types'

/**
 * Ruby's standard `net/http`.
 *
 * The verb is a *class* here — `Net::HTTP::Get`, `Net::HTTP::Post` — rather than a string,
 * so the method name is title-cased into one. Every method the editor offers has a class;
 * `Net::HTTP::Options` and `Net::HTTP::Head` included.
 *
 * `Net::HTTP.start` with `use_ssl` derived from the scheme is the shape that works for
 * both http and https without a branch. What it cannot express is the redirect policy:
 * `net/http` does not follow redirects at all, and the loop that would is a dozen lines
 * that would bury the request. The policy line beside the code says what the app does.
 *
 * A quoted heredoc carries a multi-line body, flush left rather than indented under its
 * assignment — see `quote.rubyHeredoc` for why the prettier of the two forms is the one
 * that changes the payload.
 */
export const ruby = (wire: Wire): string => {
  const verb = wire.method.charAt(0) + wire.method.slice(1).toLowerCase()
  const text = bodyOf(wire)
  const literal = (multiline(text) ? rubyHeredoc(text, 'BODY', '  ') : null) ?? double(text)
  const parts = partsOf(wire)
  const file = fileOf(wire)

  // StringIO only when something needs it: `set_form` takes a bare string for a text
  // part, and reaches for an IO only when that part also carries a content type.
  const requires = ['require "net/http"', 'require "uri"']
  if (parts.some(part => part.kind !== 'file' && part.contentType)) requires.push('require "stringio"')

  const lines = [...requires, '', `uri = URI(${double(wire.url)})`, `request = Net::HTTP::${verb}.new(uri)`]
  for (const header of snippetHeaders(wire)) lines.push(`request[${double(header.key)}] = ${double(header.value)}`)

  if (parts.length) {
    // `set_form` with an explicit "multipart/form-data" builds the envelope *and* writes
    // the Content-Type with its own boundary — which is why `snippetHeaders` withheld the
    // app's. A three-element entry is [name, io, options], and `content_type` in those
    // options is what carries a per-part type; net/http has no other way to set one.
    lines.push('', 'form = [')
    for (const part of parts) {
      if (part.kind !== 'file') {
        const options = part.contentType ? `, { content_type: ${double(part.contentType)} }` : ''
        const value = part.contentType ? `StringIO.new(${double(part.value)})` : double(part.value)
        lines.push(`  [${double(part.name)}, ${value}${options}],`)
      } else {
        lines.push(
          `  [${double(part.name)}, File.open(${double(part.path)}), { filename: ${double(part.filename)}, content_type: ${double(part.contentType)} }],`,
        )
      }
    }
    lines.push(']', 'request.set_form(form, "multipart/form-data")')
  } else if (file) {
    // `binread` rather than `read`: on Windows the default mode translates CRLF, which
    // would corrupt every attachment that is not text.
    lines.push(`request.body = File.binread(${double(file.path)})`)
  } else if (isTextBody(wire)) {
    lines.push(`request.body = ${literal}`)
  }

  lines.push(
    '',
    `response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https", read_timeout: ${seconds(wire)}) do |http|`,
    '  http.request(request)',
    'end',
    '',
    'puts response.body',
  )
  return lines.join('\n')
}
