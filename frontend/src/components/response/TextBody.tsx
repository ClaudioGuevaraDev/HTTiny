import CodeMirror from '@uiw/react-codemirror'
import { httinyTheme } from '../../editorTheme'
import { extensionsFor } from '../../response/syntax'
import type { BodyLanguage } from '../../types'

/**
 * The read-only editor every textual body is shown in.
 *
 * Extracted from `ResponseViewer` unchanged in behaviour: it replaced a regex
 * highlighter that piped server content through `dangerouslySetInnerHTML` and only
 * coloured strings preceded by a colon, so array elements came out plain and the
 * response disagreed with the request editor about what JSON looks like. Sharing
 * `httinyTheme` makes them match by construction, and CodeMirror renders only the
 * visible lines rather than building one enormous `<pre>`.
 *
 * `text` is already formatted by the caller, which also owns the pretty/raw choice —
 * the copy button in the header has to put the same string on the clipboard as the one
 * on screen, so there is exactly one place that decides what that string is.
 *
 * `basicSetup` overrides only three flags, so everything else `@uiw` turns on by
 * default stays on. That includes `searchKeymap`, which is why Ctrl+F opens
 * CodeMirror's own search panel inside the body — see the button in `ResponseViewer`
 * that finally says so out loud.
 */
export function TextBody({ text, language, wrap }: { text: string; language: BodyLanguage; wrap: boolean }) {
  return (
    <CodeMirror
      value={text}
      theme={httinyTheme}
      extensions={extensionsFor(language, wrap)}
      editable={false}
      basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
    />
  )
}
