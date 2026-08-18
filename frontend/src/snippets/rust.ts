import { double, multiline, rustRaw } from './quote'
import { bodyOf, fileOf, isTextBody, partsOf, seconds, snippetHeaders, type Wire } from './types'

/**
 * reqwest, async, on tokio — the pairing its own documentation opens with.
 *
 * `reqwest::Method::GET` and friends are associated constants, and every verb the editor
 * offers has one, so the method needs no parsing.
 *
 * `redirect::Policy::limited` is spelled out even though reqwest follows redirects by
 * default: its default limit is 10, which happens to match, and a snippet that silently
 * relies on a library default matching an app constant is one library release away from
 * being wrong.
 *
 * A raw string (`r#"…"#`) carries a multi-line body, escaping nothing at all, with
 * `quote.rustRaw` reaching for more hashes if the payload contains the delimiter.
 */
export const rust = (wire: Wire): string => {
  const text = bodyOf(wire)
  const literal = multiline(text) ? rustRaw(text) : double(text)
  const parts = partsOf(wire)
  const file = fileOf(wire)

  const lines: string[] = []
  if (parts.length) {
    // Not a default feature: `reqwest = { version = "0.12", features = ["multipart"] }`.
    // Saying so here rather than leaving a compile error to explain it.
    lines.push('// Cargo.toml: reqwest = { version = "0.12", features = ["multipart"] }')
  }
  lines.push('use std::time::Duration;', '', '#[tokio::main]', 'async fn main() -> Result<(), Box<dyn std::error::Error>> {')

  if (parts.length) {
    lines.push('    let form = reqwest::multipart::Form::new()')
    parts.forEach((part, index) => {
      const last = index === parts.length - 1
      const tail = last ? ';' : ''
      if (part.kind !== 'file' && !part.contentType) {
        lines.push(`        .text(${double(part.name)}, ${double(part.value)})${tail}`)
        return
      }
      // `Part::bytes` over `Part::stream`: the file is read up front, which is what gives
      // the request a known length — the same trade `materialise` makes on the app's side,
      // and what keeps the body replayable across a redirect.
      const source =
        part.kind === 'file'
          ? `reqwest::multipart::Part::bytes(std::fs::read(${double(part.path)})?)\n            .file_name(${double(part.filename)})`
          : `reqwest::multipart::Part::text(${double(part.value)})`
      lines.push(`        .part(${double(part.name)}, ${source}\n            .mime_str(${double(part.contentType)})?)${tail}`)
    })
    lines.push('')
  }

  lines.push('    let client = reqwest::Client::builder()')
  lines.push(
    `        .timeout(Duration::from_secs(${seconds(wire)}))`,
    `        .redirect(reqwest::redirect::Policy::limited(${wire.policy.maxRedirects}))`,
    '        .build()?;',
    '',
    '    let response = client',
    `        .request(reqwest::Method::${wire.method}, ${double(wire.url)})`,
  )
  for (const header of snippetHeaders(wire)) lines.push(`        .header(${double(header.key)}, ${double(header.value)})`)
  // `.multipart` writes the Content-Type with its own boundary, which is why
  // `snippetHeaders` withheld the app's.
  if (parts.length) lines.push('        .multipart(form)')
  else if (file) lines.push(`        .body(std::fs::read(${double(file.path)})?)`)
  else if (isTextBody(wire)) lines.push(`        .body(${literal})`)
  lines.push('        .send()', '        .await?;', '', '    println!("{}", response.text().await?);', '    Ok(())', '}')
  return lines.join('\n')
}
