import { double } from './quote'
import { allSnippetHeaders, bodyOf, fileOf, isTextBody, partDisposition, partsOf, seconds, type Wire } from './types'

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
  const parts = partsOf(wire)
  const lines = [
    ...(parts.length ? multipartLines(wire) : []),
    'HttpClient client = HttpClient.newBuilder()',
    '    .followRedirects(HttpClient.Redirect.NORMAL)',
    '    .build();',
    '',
    'HttpRequest request = HttpRequest.newBuilder()',
    `    .uri(URI.create(${double(wire.url)}))`,
    `    .method(${double(wire.method)}, ${publisher(wire)})`,
  ]
  // `allSnippetHeaders`, not `snippetHeaders`: this is the one library target that writes
  // the multipart envelope itself, around the app's own boundary, so it is also the one
  // that must keep the Content-Type carrying that boundary.
  for (const header of allSnippetHeaders(wire)) lines.push(`    .header(${double(header.key)}, ${double(header.value)})`)
  lines.push(
    `    .timeout(Duration.ofSeconds(${seconds(wire)}))`,
    '    .build();',
    '',
    'HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());',
    'System.out.println(response.body());',
  )
  return lines.join('\n')
}

const publisher = (wire: Wire): string => {
  if (partsOf(wire).length) return 'HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())'
  const file = fileOf(wire)
  // `ofFile` streams from disk and sets the length from it, which is exactly what the
  // `binary` body type is. It throws FileNotFoundException, so the enclosing method has
  // to declare or catch it — as it already must for `client.send`.
  if (file) return `HttpRequest.BodyPublishers.ofFile(Path.of(${double(file.path)}))`
  return isTextBody(wire) ? `HttpRequest.BodyPublishers.ofString(${double(bodyOf(wire))})` : 'HttpRequest.BodyPublishers.noBody()'
}

/**
 * The multipart body, written out by hand.
 *
 * The JDK client has **no multipart support of any kind** — no form builder, no
 * `BodyPublishers.ofFormData` — so the choice is between pulling in a dependency and
 * assembling the envelope. Assembling it is the honest one for a target whose whole
 * selling point is that it needs nothing added, and it is the reason this generator keeps
 * the `Content-Type` header: the boundary written below is the app's, so the header
 * describing it is correct as it stands.
 *
 * `\r\n` throughout, because that is what the wire uses and what a lenient parser on the
 * other end should not have to forgive.
 */
const multipartLines = (wire: Wire): string[] => {
  const delimiter = escapeForJava(`--${wire.boundary}`)
  const write = (literal: string) => `body.write("${literal}".getBytes(StandardCharsets.UTF_8));`
  const lines = ['var body = new ByteArrayOutputStream();']
  for (const part of partsOf(wire)) {
    const header = [`Content-Disposition: ${partDisposition(part)}`, ...(part.contentType ? [`Content-Type: ${part.contentType}`] : [])]
    lines.push(write(`${delimiter}\\r\\n${header.map(escapeForJava).join('\\r\\n')}\\r\\n\\r\\n`))
    if (part.kind === 'file') lines.push(`body.write(Files.readAllBytes(Path.of(${double(part.path)})));`)
    else lines.push(`body.write(${double(part.value)}.getBytes(StandardCharsets.UTF_8));`)
    lines.push(write('\\r\\n'))
  }
  lines.push(write(`${delimiter}--\\r\\n`), '')
  return lines
}

/** A header line going inside an already-quoted Java literal, so only `"` and `\` matter. */
const escapeForJava = (value: string): string => value.split('\\').join('\\\\').split('"').join('\\"')
