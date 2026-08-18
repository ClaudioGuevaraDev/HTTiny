import { csharpVerbatim, double, multiline } from './quote'
import { bodyOf, fileOf, isTextBody, partsOf, seconds, snippetHeaders, type Wire } from './types'

/**
 * .NET's `HttpClient`.
 *
 * The one thing this target has to get right that the others do not: **.NET splits
 * headers in two**. `Content-Type` and its `Content-*` siblings live on the *content*,
 * not on the request, and `request.Headers.TryAddWithoutValidation("Content-Type", …)` is
 * not merely ignored — `request.Headers.Add` throws `InvalidOperationException` for it. So
 * the content type is passed to `StringContent`, where it belongs, and dropped from the
 * header loop.
 *
 * `TryAddWithoutValidation` for everything else, rather than `Add`: .NET validates header
 * values against their expected grammar and rejects things a server accepts happily,
 * which would turn a working request into an exception.
 *
 * A verbatim string (`@"…"`) carries a multi-line body — its only escape is a doubled
 * quote, so nothing else in a JSON payload needs touching.
 */
export const csharp = (wire: Wire): string => {
  const headers = snippetHeaders(wire)
  const contentType = headers.find(header => header.key.toLowerCase() === 'content-type')
  const text = bodyOf(wire)
  const literal = multiline(text) ? csharpVerbatim(text) : double(text)
  const parts = partsOf(wire)
  const file = fileOf(wire)

  const lines = [
    'using var client = new HttpClient',
    '{',
    `    Timeout = TimeSpan.FromSeconds(${seconds(wire)}),`,
    '};',
    '',
    `using var request = new HttpRequestMessage(new HttpMethod(${double(wire.method)}), ${double(wire.url)});`,
  ]
  for (const header of headers) {
    // Skipped only when there is a body to carry it. A Content-Type typed with no body
    // has nowhere else to go, and dropping it silently would change the request.
    if (header === contentType && wire.hasBody) continue
    lines.push(`request.Headers.TryAddWithoutValidation(${double(header.key)}, ${double(header.value)});`)
  }

  if (parts.length) {
    // MultipartFormDataContent writes its own boundary and its own Content-Type header,
    // which is why `snippetHeaders` did not offer the app's.
    lines.push('', 'var content = new MultipartFormDataContent();')
    parts.forEach((part, index) => {
      if (part.kind !== 'file') {
        lines.push(`var part${index} = new StringContent(${double(part.value)});`)
        if (part.contentType) lines.push(`part${index}.Headers.ContentType = new MediaTypeHeaderValue(${double(part.contentType)});`)
        lines.push(`content.Add(part${index}, ${double(part.name)});`)
        return
      }
      lines.push(
        `var part${index} = new StreamContent(File.OpenRead(${double(part.path)}));`,
        `part${index}.Headers.ContentType = new MediaTypeHeaderValue(${double(part.contentType)});`,
        // The third argument is the part's filename. Without it .NET omits the
        // `filename` parameter entirely and the server sees a field, not an upload.
        `content.Add(part${index}, ${double(part.name)}, ${double(part.filename)});`,
      )
    })
    lines.push('request.Content = content;')
  } else if (file) {
    lines.push(
      '',
      `request.Content = new StreamContent(File.OpenRead(${double(file.path)}));`,
      `request.Content.Headers.ContentType = new MediaTypeHeaderValue(${double(file.contentType)});`,
    )
  } else if (isTextBody(wire)) {
    // The media type goes in as the bare type: StringContent appends the charset itself,
    // and handing it a full `application/json; charset=utf-8` throws a FormatException.
    const media = contentType ? double(contentType.value.split(';')[0].trim()) : 'null'
    lines.push(`request.Content = new StringContent(${literal}, Encoding.UTF8, ${media});`)
  }

  lines.push('', 'var response = await client.SendAsync(request);', 'Console.WriteLine(await response.Content.ReadAsStringAsync());')
  return lines.join('\n')
}
