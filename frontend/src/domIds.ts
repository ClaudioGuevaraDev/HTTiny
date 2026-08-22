/**
 * Element ids that two components have to agree on. A tab and the panel it controls
 * point at each other through `aria-controls`/`aria-labelledby`, so the id has to be
 * derived the same way in `RequestTabs` and in `RequestEditor` — and it cannot live in
 * either of them, since a component file that also exports a helper breaks fast refresh.
 */
export const requestTabId = (id: string) => `request-tab-${id}`

/**
 * The request body's CodeMirror wrapper.
 *
 * `useGlobalShortcuts` needs it to keep its hands off Ctrl+F while the caret is in
 * there: that editor keeps its own `searchKeymap`, and the response viewer's find bar
 * must not steal a keystroke aimed at the body you are editing.
 *
 * An id rather than a class check, for the reason `shortcuts.ts` records at the top of
 * the file — wiring behaviour to a CSS class is how Ctrl+Enter silently broke once.
 */
export const requestBodyEditorId = 'request-body-editor'

/**
 * The URL field.
 *
 * The response pane's INVALID_URL placeholder focuses it, which makes the id a contract
 * between two components that share no props — so it is named once here rather than
 * typed as a literal in each, the same argument `requestBodyEditorId` makes about
 * classes.
 */
export const requestUrlFieldId = 'request-url'
