import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { EditorView, type Extension } from '@uiw/react-codemirror'

/**
 * Replaces the `oneDark` theme, which had its own palette and so made the body
 * editor and the response viewer disagree about what a JSON string looks like.
 *
 * Every colour is a `var()` reference rather than a literal, so the CSS tokens stay
 * the single source of truth. This is exactly why `theme.css` uses `@theme static`:
 * Tailwind's default lazy emission only keeps variables it can see being used, and
 * it cannot see these ones inside JS strings.
 *
 * `EditorView` is imported from `@uiw/react-codemirror` rather than
 * `@codemirror/view` so there is one module instance and no duplicate-package
 * hazard.
 */
const chrome = EditorView.theme(
  {
    /*
     * The background is a variable with a fallback, not a fixed token, because the same
     * theme is used on two different plates: the request and response panes, which *are*
     * `--color-surface-1`, and the code view's modal, which is `--color-surface-2` and
     * where a surface-1 editor read as a darker rectangle pasted into the dialog.
     *
     * A custom property set on an ancestor is what makes that overridable at all.
     * CodeMirror injects its own rules through StyleModule at runtime, unlayered, and
     * unlayered CSS beats every `@layer` whatever the specificity — so a plain
     * `.code-body .cm-editor { background: … }` in `@layer components` would silently do
     * nothing. See the comment at the top of `styles/codemirror.css`.
     */
    '&': {
      color: 'var(--color-text)',
      backgroundColor: 'var(--editor-surface, var(--color-surface-1))',
      fontSize: 'var(--text-code)',
    },
    '&.cm-editor': { height: '100%' },
    '&.cm-editor.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: 'var(--text-code--line-height)',
    },
    '.cm-content': {
      padding: '12px 0',
      caretColor: 'var(--color-accent)',
    },
    '.cm-line': { padding: '0 16px' },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--color-accent)',
      borderLeftWidth: '2px',
    },
    '.cm-activeLine': { backgroundColor: 'var(--color-surface-code-active)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--color-selection)',
    },
    '.cm-selectionMatch': { backgroundColor: 'var(--color-selection-match)' },
    '.cm-gutters': {
      backgroundColor: 'var(--editor-surface, var(--color-surface-1))',
      color: 'var(--color-text-faint)',
      border: 'none',
      borderRight: '1px solid var(--color-border-subtle)',
    },
    '.cm-lineNumbers .cm-gutterElement': { minWidth: '36px', padding: '0 8px 0 12px' },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--color-surface-code-active)',
      color: 'var(--color-text-muted)',
    },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--color-bracket-match)',
      outline: '1px solid var(--color-border-control)',
    },
    '.cm-nonmatchingBracket': { color: 'var(--color-danger)' },
    '.cm-placeholder': { color: 'var(--color-text-faint)' },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--color-surface-4)',
      border: 'none',
      color: 'var(--color-text-muted)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--color-surface-4)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 'var(--radius-md)',
      color: 'var(--color-text)',
    },
    '.cm-panels': { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-text)' },
  },
  { dark: true },
)

/**
 * `@lezer/json` tags exactly five things — String, Number, True/False, PropertyName
 * and Null — and leaves braces, brackets, colons and commas untagged. That is the
 * same token model the response viewer's highlighter uses, which is why pointing
 * both at these four variables makes them match exactly.
 *
 * The punctuation and comment entries are inert for JSON but correct for any
 * language added later.
 */
const highlight = HighlightStyle.define([
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--color-syntax-key)' },
  { tag: [tags.string, tags.special(tags.string), tags.docString], color: 'var(--color-syntax-string)' },
  { tag: [tags.number, tags.integer, tags.float], color: 'var(--color-syntax-number)' },
  { tag: [tags.bool, tags.null, tags.atom, tags.keyword], color: 'var(--color-syntax-literal)' },
  {
    tag: [tags.punctuation, tags.separator, tags.brace, tags.bracket, tags.squareBracket, tags.paren],
    color: 'var(--color-syntax-punctuation)',
  },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--color-syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--color-syntax-key)', textDecoration: 'underline' },
  { tag: tags.invalid, color: 'var(--color-danger)' },
])

export const httinyTheme: Extension = [chrome, syntaxHighlighting(highlight)]
