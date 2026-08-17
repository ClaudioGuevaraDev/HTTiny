import { double, multiline, rustRaw } from './quote'
import { bodyOf, seconds, snippetHeaders, type Wire } from './types'

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

  const lines = [
    'use std::time::Duration;',
    '',
    '#[tokio::main]',
    'async fn main() -> Result<(), Box<dyn std::error::Error>> {',
    '    let client = reqwest::Client::builder()',
    `        .timeout(Duration::from_secs(${seconds(wire)}))`,
    `        .redirect(reqwest::redirect::Policy::limited(${wire.policy.maxRedirects}))`,
    '        .build()?;',
    '',
    '    let response = client',
    `        .request(reqwest::Method::${wire.method}, ${double(wire.url)})`,
  ]
  for (const header of snippetHeaders(wire)) lines.push(`        .header(${double(header.key)}, ${double(header.value)})`)
  if (wire.hasBody) lines.push(`        .body(${literal})`)
  lines.push('        .send()', '        .await?;', '', '    println!("{}", response.text().await?);', '    Ok(())', '}')
  return lines.join('\n')
}
