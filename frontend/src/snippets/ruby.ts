import { double, multiline, rubyHeredoc } from './quote'
import { bodyOf, seconds, snippetHeaders, type Wire } from './types'

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

  const lines = ['require "net/http"', 'require "uri"', '', `uri = URI(${double(wire.url)})`, `request = Net::HTTP::${verb}.new(uri)`]
  for (const header of snippetHeaders(wire)) lines.push(`request[${double(header.key)}] = ${double(header.value)}`)
  if (wire.hasBody) lines.push(`request.body = ${literal}`)
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
