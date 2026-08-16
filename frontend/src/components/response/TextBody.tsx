import { useEffect, useRef } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { httinyTheme } from '../../editorTheme'
import { extensionsFor } from '../../response/syntax'
import type { Match } from '../../response/search'
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
 * `searchKeymap: false` is what stops CodeMirror opening its own search panel on
 * Ctrl+F. That panel is replaced by `ResponseSearchBar`, which also covers the headers
 * tab and follows the theme — `editorTheme.ts` only ever styled `.cm-panels`, never
 * anything inside it. The *request* body editor keeps its keymap and its panel, which
 * is why that rule has to stay.
 */
export function TextBody({
  text,
  language,
  wrap,
  match,
}: {
  text: string
  language: BodyLanguage
  wrap: boolean
  /** The match to reveal, or null when nothing is being searched for. */
  match: Match | null
}) {
  const view = useRef<EditorView | null>(null)

  /**
   * Selecting the match is what highlights it — and, for free, what highlights the
   * others. `basicSetup` leaves `highlightSelectionMatches` on, so every run equal to
   * the selection picks up `.cm-selectionMatch`, which `editorTheme.ts` already paints
   * from `--color-selection-match`. That is the whole reason this needs no search
   * dependency: the editor is told where to look, not asked where to look.
   *
   * Guarded on the document length because the effect can run one commit before the new
   * body reaches CodeMirror — switching requests changes `text` and `match` together,
   * and a range past the end of the old document throws rather than being clamped.
   */
  useEffect(() => {
    const editor = view.current
    if (!editor || !match) return
    if (match.to > editor.state.doc.length) return
    editor.dispatch({
      selection: { anchor: match.from, head: match.to },
      effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
    })
  }, [match])

  // The view is destroyed whenever this unmounts, which `BodyPanel` does on every switch
  // to the hex dump or a rich view. Dispatching to a destroyed view throws, so the
  // handle has to go with it.
  useEffect(() => () => { view.current = null }, [])

  return (
    <CodeMirror
      value={text}
      theme={httinyTheme}
      extensions={extensionsFor(language, wrap)}
      editable={false}
      basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false, searchKeymap: false }}
      onCreateEditor={editor => {
        view.current = editor
      }}
    />
  )
}
