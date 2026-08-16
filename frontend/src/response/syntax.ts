import { StreamLanguage } from '@codemirror/language'
import { EditorView } from '@uiw/react-codemirror'
import type { Extension } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/legacy-modes/mode/css'
import { html, xml } from '@codemirror/legacy-modes/mode/xml'
import { javascript } from '@codemirror/legacy-modes/mode/javascript'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'
import type { BodyLanguage } from '../types'

/**
 * Syntax highlighting per body language, in a wrapped and an unwrapped variant.
 *
 * This reverses a decision that used to be written into `ResponseViewer`: HTML and XML
 * rendered as wrapped plain text rather than pull in `@codemirror/lang-html` and
 * `lang-xml`, on the grounds that an HTTP client inspects them far less often than
 * JSON. The trade held while there were four formats; it does not hold now that the
 * viewer claims to cover whatever an endpoint returns, and a YAML config or a SOAP
 * envelope rendered as undifferentiated grey is exactly the gap this work closes.
 *
 * It is paid for with **one** dependency rather than six. `@codemirror/legacy-modes`
 * carries the stream grammars for XML, HTML, CSS, JavaScript and YAML in a single
 * package. The Lezer `lang-*` packages parse properly and would add folding by element,
 * but at five more exact-pinned direct dependencies for colour on formats that are read
 * far more often than they are edited. JSON keeps its real parser, which it already had
 * and which the request editor shares.
 *
 * Every array is built once, at module scope. A fresh `extensions` array on each render
 * makes CodeMirror reconfigure itself for nothing, and this viewer re-renders ten times
 * a second while a *later* request is in flight — which is why the wrap toggle picks
 * between two prebuilt arrays instead of composing one.
 */
const WRAP = EditorView.lineWrapping

interface Variants {
  wrapped: Extension[]
  unwrapped: Extension[]
}

const variants = (base: Extension[]): Variants => ({ wrapped: [...base, WRAP], unwrapped: base })
const streamMode = (mode: Parameters<typeof StreamLanguage.define>[0]): Variants => variants([StreamLanguage.define(mode)])

// One shared instance per grammar: `json()` and `StreamLanguage.define` both build a
// parser, and ndjson/json — like svg/xml — have no reason to build a second one.
const JSON_MODE = variants([json()])
const XML_MODE = streamMode(xml)
const PLAIN = variants([])

/**
 * `svg` reads as XML because that is what it is, and `ndjson` as JSON because each line
 * is: a stream grammar resynchronises at every line break, so a run of records colours
 * correctly even though the document as a whole is not one JSON value.
 *
 * `csv`, `sse` and `markdown` stay plain on purpose. All three have a dedicated viewer,
 * and the raw text behind them is a fallback whose structure a grammar built for
 * something else would misrepresent rather than clarify.
 */
const TABLE: Record<BodyLanguage, Variants> = {
  json: JSON_MODE,
  ndjson: JSON_MODE,
  xml: XML_MODE,
  svg: XML_MODE,
  html: streamMode(html),
  css: streamMode(css),
  javascript: streamMode(javascript),
  yaml: streamMode(yaml),
  csv: PLAIN,
  markdown: PLAIN,
  sse: PLAIN,
  text: PLAIN,
}

export const extensionsFor = (language: BodyLanguage, wrap: boolean): Extension[] => (wrap ? TABLE[language].wrapped : TABLE[language].unwrapped)
