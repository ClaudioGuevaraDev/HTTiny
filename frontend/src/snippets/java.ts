import { double } from './quote'
import { bodyOf, seconds, snippetHeaders, type Wire } from './types'

/**
 * `java.net.http.HttpClient`, the JDK 11 client — no dependency to add.
 *
 * `.method(name, publisher)` rather than `.GET()` / `.POST()`, for the same reason the
 * other targets take the verb as data: one shape covers every method, including the ones
 * with no builder shorthand.
 *
 * `followRedirects(NORMAL)` is required, not decorative — the JDK client's default is
 * `NEVER`, so without it this reports the 302 the app followed. NORMAL is the right one of
 * the two following modes: it declines to carry an HTTPS request onward to a plain HTTP
 * location, which is what `ALWAYS` would do.
 *
 * The escaped single-line literal is used even for a multi-line body. A JDK 15 text block
 * would read better, but its indentation is significant and stripped by rules that depend
 * on the closing delimiter's column — a body whose own lines are indented comes back
 * subtly different, and a snippet that quietly changes the payload is worse than a long
 * line.
 */
export const java = (wire: Wire): string => {
  const lines = [
    'HttpClient client = HttpClient.newBuilder()',
    '    .followRedirects(HttpClient.Redirect.NORMAL)',
    '    .build();',
    '',
    'HttpRequest request = HttpRequest.newBuilder()',
    `    .uri(URI.create(${double(wire.url)}))`,
    `    .method(${double(wire.method)}, ${wire.hasBody ? `HttpRequest.BodyPublishers.ofString(${double(bodyOf(wire))})` : 'HttpRequest.BodyPublishers.noBody()'})`,
  ]
  for (const header of snippetHeaders(wire)) lines.push(`    .header(${double(header.key)}, ${double(header.value)})`)
  lines.push(
    `    .timeout(Duration.ofSeconds(${seconds(wire)}))`,
    '    .build();',
    '',
    'HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());',
    'System.out.println(response.body());',
  )
  return lines.join('\n')
}
