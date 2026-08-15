/**
 * The English catalogue, and the source of truth for the key set.
 *
 * `as const` at the bottom is load-bearing: it makes every value a string *literal*
 * type, which is what lets `Placeholders<S>` read the `{name}` slots out of a message
 * at compile time. Without it every value is `string`, and `t()` would silently accept
 * any params, or none.
 *
 * Keys are flat and dotted rather than nested. Three reasons: `keyof typeof en` is a
 * plain union with no recursive `Paths<T>` helper; `t(`error.${code}.title`)` and
 * `t(`editor.panel.${panel}`)` are checked against real keys, which nesting cannot do;
 * and one message per line keeps a diff readable at `printWidth: 160`.
 *
 * What is deliberately absent: HTTP methods, status reason phrases, format badges,
 * byte and time units, key-cap names, and the technical placeholders that are examples
 * of machine input. See CLAUDE.md for the full policy.
 */
export const en = {
  // ── App shell ────────────────────────────────────────────────────────────────
  'app.skipLink': 'Skip to Workspace',
  'app.resizeSidebar': 'Resize sidebar',
  'app.showSidebar': 'Show sidebar',
  'app.hideSidebar': 'Hide sidebar',
  'app.resizeColumns': 'Resize request and response columns',
  'app.resizeRows': 'Resize request and response rows',

  // ── Sidebar ──────────────────────────────────────────────────────────────────
  'sidebar.nav': 'Collections',
  'sidebar.search': 'Search requests',
  'sidebar.renameInput': 'Rename {name}',
  'sidebar.save.browser': 'Not saved — browser preview',
  'sidebar.save.newer': 'Newer workspace — not saving',
  'sidebar.save.failed': 'Save failed',
  'sidebar.save.saving': 'Saving…',
  'sidebar.save.noKeychain': 'Saved · no keychain',
  'sidebar.save.saved': 'Saved',
  'sidebar.noCollections.title': 'No collections yet',
  'sidebar.noCollections.desc': 'Collections group your requests. Create one to get started.',
  'sidebar.noCollections.action': 'New collection',
  'sidebar.empty.title': 'Nothing here yet',
  'sidebar.empty.desc': '“{name}” has no requests. Add one to send your first call.',
  'sidebar.empty.newRequest': 'New request',
  'sidebar.empty.newFolder': 'New folder',

  // ── Collection rail ──────────────────────────────────────────────────────────
  'rail.collections': 'Collections',
  'rail.showPanel.aria': 'Show collection panel',
  'rail.hidePanel.aria': 'Hide collection panel',
  'rail.showPanel.title': 'Show panel',
  'rail.hidePanel.title': 'Hide panel',
  'rail.newCollection': 'New collection',

  // ── Tab strip ────────────────────────────────────────────────────────────────
  'tabs.list': 'Open requests',
  'tabs.close': 'Close {name}',

  // ── Workspace actions ────────────────────────────────────────────────────────
  'workspace.sideBySide.aria': 'Switch to side-by-side layout',
  'workspace.stacked.aria': 'Switch to stacked layout',
  'workspace.sideBySide.title': 'Side by side ({keys})',
  'workspace.stacked.title': 'Stacked ({keys})',
  'workspace.palette.aria': 'Open command palette',
  'workspace.palette.title': 'Search ({keys})',
  'workspace.settings.aria': 'Open settings',
  'workspace.settings.title': 'Settings ({keys})',

  // ── Request editor ───────────────────────────────────────────────────────────
  'editor.empty.title': 'No request open',
  'editor.empty.desc': 'Open something from the sidebar, or start a new request.',
  'editor.empty.newRequest': 'New request',
  'editor.empty.search': 'Search requests',
  'editor.method': 'HTTP method',
  'editor.url': 'Request URL',
  'editor.save.title': 'Save now ({keys})',
  'editor.send.title': 'Send request ({keys})',
  'editor.cancel.title': 'Cancel request ({keys})',
  'editor.send': 'Send',
  'editor.cancel': 'Cancel',
  'editor.sections': 'Request sections',
  'editor.panel.params': 'Params',
  'editor.panel.headers': 'Headers',
  'editor.panel.body': 'Body',
  'editor.panel.auth': 'Auth',
  // Two counts, not one: Spanish agrees the adjective with the noun, and these render
  // under Params (m.) and Headers (f.) respectively.
  'editor.panel.paramsEnabled.one': ', {count} enabled',
  'editor.panel.paramsEnabled.other': ', {count} enabled',
  'editor.panel.headersEnabled.one': ', {count} enabled',
  'editor.panel.headersEnabled.other': ', {count} enabled',
  'editor.kv.key': 'Key',
  'editor.kv.value': 'Value',
  'editor.kv.description': 'Description',
  'editor.kv.keyPlaceholder': 'Key…',
  'editor.kv.valuePlaceholder': 'Value…',
  'editor.kv.descriptionPlaceholder': 'Optional description…',
  'editor.kv.enableNamed': 'Enable {name}',
  'editor.kv.enableRow': 'Enable row',
  'editor.kv.deleteRow': 'Delete row',
  // Whole sentences rather than "Add" + a noun: the article and the gender travel
  // with the noun in Spanish.
  'editor.kv.addParam': 'Add Parameter',
  'editor.kv.addHeader': 'Add Header',
  'editor.body.type': 'Body type',
  'editor.body.none': 'None',
  'editor.body.formatJson': 'Format JSON',
  'editor.body.emptyTitle': 'No body',
  'editor.body.emptyDesc': 'Pick JSON or Text above to send one.',
  'editor.body.aria': 'Request body ({type})',
  'editor.auth.type': 'Auth type',
  'editor.auth.none': 'No Auth',
  'editor.auth.bearer': 'Bearer Token',
  'editor.auth.basic': 'Basic Auth',
  'editor.auth.noneNote': 'No auth. Requests are sent without credentials.',
  'editor.auth.token': 'Token',
  'editor.auth.username': 'Username',
  'editor.auth.password': 'Password',

  // ── Response ─────────────────────────────────────────────────────────────────
  'response.region': 'Response',
  'response.metric.time': 'Time',
  'response.metric.size': 'Size',
  'response.metric.headers': 'Headers',
  'response.metric.elapsed': 'Elapsed',
  'response.metric.code': 'Code',
  'response.pill.sending': 'Sending…',
  'response.pill.failed': 'Failed',
  'response.pill.idle': 'No response yet',
  'response.announce.error': 'Request failed: {title}. {detail}',
  'response.copyBody.aria': 'Copy response body',
  'response.copiedBody.aria': 'Response body copied',
  'response.copyBody.title': 'Copy body',
  'response.copied.title': 'Copied',
  'response.clear.aria': 'Clear response',
  'response.clear.title': 'Clear',
  'response.copied.live': 'Copied to clipboard',
  'response.copyFailed.live': 'Could not copy — clipboard access was denied',
  'response.idle.title': 'Nothing sent yet',
  'response.idle.desc': 'Run this request to inspect its status, headers and body.',
  'response.idle.send': 'Send request',
  'response.loading.note': 'Waiting for a response… · {elapsed}',
  'response.loading.cancel': 'Cancel',
  'response.error.retry': 'Retry',
  'response.error.fixUrl': 'Fix the URL',
  'response.error.copyDetails': 'Copy Details',
  'response.error.copied': 'Copied',
  'response.sections': 'Response sections',
  'response.tab.body': 'Body',
  'response.tab.headers': 'Headers',
  'response.tab.returned.one': ', {count} returned',
  'response.tab.returned.other': ', {count} returned',
  'response.formatting': 'Body formatting',
  'response.formatting.onlyJson': 'Only JSON can be reformatted',
  'response.mode.pretty': 'Pretty',
  'response.mode.raw': 'Raw',
  'response.interpretAs': 'Interpret body as',
  'response.language.text': 'Text',
  'response.binary.title': 'Binary response',
  'response.binary.desc': '{size}. Binary bodies are not sent to the viewer.',
  'response.binary.descWithType': '{size} of {type}. Binary bodies are not sent to the viewer.',
  'response.truncated': 'Showing the first {limit} of {size}.',
  'response.invalidJson': 'This body is not valid JSON — showing it as it arrived.',
  'response.noContent.title': '204 No Content',
  'response.noContent.desc': 'The server answered without a body, by design.',
  'response.emptyBody.title': 'Empty body',
  'response.emptyBody.desc': 'The response arrived with nothing in it.',
  'response.headers.caption': 'Response headers',
  'response.headers.name': 'Name',
  'response.headers.value': 'Value',

  // ── Tree row actions ─────────────────────────────────────────────────────────
  // The aria/title pair differs on purpose: the accessible name takes the bare name,
  // the tooltip wraps it in typographic quotes.
  'tree.actions': 'Actions for {name}',
  'tree.newRequestIn.aria': 'New request in {name}',
  'tree.newRequestIn.title': 'New request in “{name}”',
  'tree.newFolderIn.aria': 'New folder in {name}',
  'tree.newFolderIn.title': 'New folder in “{name}”',
  'tree.rename.aria': 'Rename {name}',
  'tree.rename.title': 'Rename “{name}”',
  'tree.delete.aria': 'Delete {name}',
  'tree.delete.title': 'Delete “{name}”',
  // Four whole sentences rather than a spliced clause. Neither en nor es has a CLDR
  // `zero` category, so an empty container gets its own message instead of going
  // through the plural with a count of 0.
  'tree.confirm.request': 'Delete “{name}”? This cannot be undone.',
  'tree.confirm.empty': 'Delete “{name}”? This cannot be undone.',
  'tree.confirm.container.one': 'Delete “{name}” and the {count} request inside it? This cannot be undone.',
  'tree.confirm.container.other': 'Delete “{name}” and the {count} requests inside it? This cannot be undone.',

  // ── Command palette ──────────────────────────────────────────────────────────
  'palette.dialog': 'Command palette',
  'palette.input.aria': 'Search requests and commands',
  'palette.input.placeholder': 'Search requests, or type > for commands…',
  'palette.results': 'Results',
  'palette.empty': 'No matches for “{query}”',
  'palette.footer.navigate': 'navigate',
  'palette.footer.run': 'run',
  'palette.footer.commands': 'commands',
  'palette.count.one': '{count} result',
  'palette.count.other': '{count} results',
  'palette.group.navigation': 'Open tabs',
  'palette.group.action': 'Actions',
  'palette.group.request': 'Requests',
  'palette.group.method': 'Change method',

  // ── Commands ─────────────────────────────────────────────────────────────────
  // `.keywords` is a hidden haystack for `fuzzyScore`, never rendered. The Spanish
  // catalogue keeps the English synonyms alongside its own: developers type `send`
  // and `save` from muscle memory whatever the UI language is.
  'command.newRequest.title': 'New request',
  'command.newRequest.keywords': 'create add request',
  'command.newFolder.title': 'New folder',
  'command.newFolder.keywords': 'create add folder group',
  'command.newCollection.title': 'New collection',
  'command.newCollection.keywords': 'create add collection',
  'command.cancel.title': 'Cancel request',
  'command.cancel.keywords': 'stop abort halt',
  'command.send.title': 'Send request',
  'command.send.keywords': 'run execute fire',
  'command.save.title': 'Save now',
  'command.save.keywords': 'persist store write flush disk',
  'command.close.title': 'Close tab',
  'command.close.keywords': 'dismiss hide',
  'command.reveal.title': 'Reveal in sidebar',
  'command.reveal.keywords': 'find locate show tree',
  'command.copyUrl.title': 'Copy request URL',
  'command.copyUrl.keywords': 'clipboard link',
  'command.copyBody.title': 'Copy response body',
  'command.copyBody.keywords': 'clipboard json',
  'command.clearResponse.title': 'Clear response',
  'command.clearResponse.keywords': 'reset dismiss',
  'command.retry.title': 'Retry request',
  'command.retry.keywords': 'again resend',
  'command.toggleSidebar.title': 'Toggle sidebar',
  'command.toggleSidebar.keywords': 'hide show collapse panel',
  'command.toggleSplit.title': 'Toggle split orientation',
  'command.toggleSplit.keywords': 'layout columns rows side by side stacked',
  'command.zoomIn.title': 'Zoom in',
  'command.zoomIn.keywords': 'zoom in bigger larger scale text size',
  'command.zoomOut.title': 'Zoom out',
  'command.zoomOut.keywords': 'zoom out smaller scale text size',
  'command.zoomReset.title': 'Reset zoom',
  'command.zoomReset.keywords': 'zoom reset actual size 100',
  'command.settings.title': 'Open settings',
  'command.settings.keywords': 'preferences options theme appearance dark light storage language',
  'command.setMethod.title': 'Set method to {method}',
  'command.setMethod.keywords': 'method {method}',

  // ── Failure copy ─────────────────────────────────────────────────────────────
  // Resolved from the code at render time, so switching language retranslates a
  // failure that is already on screen. The redirect limit and the dev command are
  // params rather than catalogue text: a translator cannot mistype what they never see.
  'error.INVALID_URL.title': 'Invalid URL',
  'error.INVALID_URL.detail': 'Enter a complete URL beginning with http:// or https://.',
  'error.TIMEOUT.title': 'Request timed out',
  'error.TIMEOUT.detail': 'No response arrived in time. The server may be slow or unreachable.',
  'error.DNS_ERROR.title': 'Host not found',
  'error.DNS_ERROR.detail': 'That hostname could not be resolved. Check it for typos.',
  'error.CONNECTION_REFUSED.title': 'Connection refused',
  'error.CONNECTION_REFUSED.detail': 'Nothing is listening on that host and port.',
  'error.TLS_ERROR.title': 'Certificate not trusted',
  'error.TLS_ERROR.detail': 'The TLS certificate could not be verified. Check the host, or use http:// if this is a local server.',
  'error.TOO_MANY_REDIRECTS.title': 'Too many redirects',
  'error.TOO_MANY_REDIRECTS.detail': 'The server redirected more than {limit} times. Check the URL and any auth you are sending.',
  'error.NETWORK_ERROR.title': 'Network error',
  'error.NETWORK_ERROR.detail': 'The connection failed before a response arrived. Check the host, the port and your network.',
  'error.BACKEND_UNAVAILABLE.title': 'Desktop backend unavailable',
  'error.BACKEND_UNAVAILABLE.detail': 'Requests are sent by the HTTiny app itself. Run `{command}` — the browser dev server has no network layer.',
  'error.UNKNOWN.title': 'Request failed',
  'error.UNKNOWN.detail': 'Something went wrong before a response arrived.',

  // ── Settings ─────────────────────────────────────────────────────────────────
  'settings.title': 'Settings',
  'settings.sections': 'Settings sections',
  // The tab labels double as the heading of their panel, which is why no panel prints one.
  'settings.section.general': 'General',
  'settings.section.appearance': 'Appearance',
  'settings.section.layout': 'Layout',
  'settings.section.storage': 'Storage',
  'settings.close': 'Close settings',
  // Short, because the navigation column is 176px wide. The sentence that has to carry the
  // whole meaning lives in the confirmation, where there is room for it.
  'settings.reset.label': 'Restore defaults',
  'settings.reset.confirm': 'Restore every setting to its default? This includes the interface language.',
  'settings.storage.title': 'Nothing here yet',
  'settings.storage.desc': 'Storage settings will live in this panel.',
  'settings.theme.label': 'Theme',
  'settings.theme.system': 'System',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  // Lower-case, for inside a sentence — the buttons above carry the capitalised
  // forms. Splicing the raw `'light'` / `'dark'` token in would read as "Siempre dark".
  'settings.theme.inline.light': 'light',
  'settings.theme.inline.dark': 'dark',
  'settings.theme.desc.system': 'Following the system, currently {theme}.',
  'settings.theme.desc.always': 'Always {theme}, whatever the system is set to.',
  'settings.zoom.label': 'Zoom',
  'settings.zoom.desc': 'Scales the whole interface.',
  // No space before the sign in English, one in Spanish — which is the whole reason this
  // is a message with a slot rather than a template in the component.
  'settings.zoom.value': '{zoom}%',
  'settings.zoom.in': 'Zoom in',
  'settings.zoom.out': 'Zoom out',
  'settings.zoom.reset': 'Reset zoom',
  'settings.codeFont.label': 'Code text size',
  'settings.codeFont.desc': 'The request and response bodies. The zoom applies on top of it.',
  'settings.codeFont.value': '{size}px',
  'settings.codeFont.in': 'Larger code text',
  'settings.codeFont.out': 'Smaller code text',
  'settings.codeFont.reset': 'Reset code text size',
  // A switch is labelled by what turning it *on* does, not by the name of the setting:
  // "Layout" beside a switch would not say which way is which. `rows` is the default, so
  // off is the factory state.
  'settings.layout.sideBySide.label': 'Side by side',
  'settings.layout.sideBySide.desc': 'Put the response beside the request instead of below it.',
  'settings.layout.sidebar.label': 'Sidebar width',
  'settings.layout.sidebar.desc': 'How much room the collections tree gets.',
  // The width stays adjustable while the sidebar is hidden — the drag handle is not
  // even mounted then, so this row is the only way to reach it. Without saying so the
  // slider would look broken.
  'settings.layout.sidebar.desc.collapsed': 'The sidebar is hidden — this applies when you show it again.',
  'settings.layout.sidebar.value': '{width} px',
  'settings.layout.split.label': 'Request and response',
  // Two variants because the ratio divides the height in `rows` and the width in
  // `columns`, the same distinction `app.resizeRows` / `app.resizeColumns` already make.
  'settings.layout.split.desc.rows': 'How the height is split between the request and the response.',
  'settings.layout.split.desc.columns': 'How the width is split between the request and the response.',
  'settings.layout.split.value': '{request} / {response}',
  // Echoes the viewer's own control (`response.interpretAs`) on purpose: it is the same
  // setting in two places, and reading it as two would be worse than the repetition.
  'settings.response.format.label': 'Interpret bodies as',
  'settings.response.format.desc': 'What the viewer opens a body as. Automatic follows the content type, and a format picked in the viewer wins for that request.',
  'settings.response.format.auto': 'Automatic',
  'settings.language.label': 'Language',
  'settings.language.desc': 'Choose the interface language.',

  // ── Default names for new nodes ──────────────────────────────────────────────
  // Written into workspace.json as user data: switching language later does not
  // rename what already exists, because by then it is content and not copy.
  'data.newRequest': 'New Request',
  'data.newCollection': 'New Collection',
  'data.newFolder': 'New Folder',
  'data.myCollection': 'My Collection',
} as const
