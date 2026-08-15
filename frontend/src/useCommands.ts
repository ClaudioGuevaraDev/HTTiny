import { useMemo } from 'react'
import { documentKeywords, flattenRequests, type Command } from './commands'
import { flushNow } from './persistence'
import { cancelRequest, runRequest, toggleRequest } from './requestRunner'
import { shortcuts } from './shortcuts'
import { methodOptions, useAppStore } from './store'

const EMPTY: Command[] = []

/**
 * Builds the palette's command list from current store state.
 *
 * Every `run` reads `useAppStore.getState()` at call time rather than closing over
 * the values used to build it, so a stale list can never act on stale state.
 */
export function useCommands(enabled: boolean): Command[] {
  const tree = useAppStore(s => s.tree)
  const documents = useAppStore(s => s.documents)
  const tabs = useAppStore(s => s.tabs)
  const recentIds = useAppStore(s => s.recentIds)
  const activeId = useAppStore(s => s.activeId)
  const sending = useAppStore(s => (s.activeId ? s.responses[s.activeId]?.state === 'loading' : false))

  return useMemo(() => {
    if (!enabled) return EMPTY

    const commands: Command[] = []
    const requests = flattenRequests(tree)
    const byId = new Map(requests.map(request => [request.requestId, request]))

    // Open tabs first, most recently used first — the common case is jumping back
    // to something you had open a minute ago.
    const ordered = [...recentIds.filter(id => tabs.includes(id)), ...tabs.filter(id => !recentIds.includes(id))]
    for (const id of ordered) {
      const doc = documents[id]
      if (!doc) continue
      const entry = byId.get(id)
      commands.push({
        id: `tab:${id}`,
        group: 'navigation',
        title: doc.name,
        subtitle: entry?.breadcrumb || doc.url,
        keywords: documentKeywords(doc, entry?.breadcrumb ?? ''),
        method: doc.method,
        // `setActive` reveals on its own now, the same as clicking the tab does.
        run: () => useAppStore.getState().setActive(id),
      })
    }

    const store = useAppStore.getState()
    const action = (id: string, title: string, keywords: string, run: () => void, shortcut?: readonly string[]) =>
      commands.push({ id: `action:${id}`, group: 'action', title, keywords: keywords.toLowerCase(), shortcut, run })

    action('new-request', 'New request', 'create add request', () => useAppStore.getState().addNode('request'), shortcuts.newRequest)
    action('new-folder', 'New folder', 'create add folder group', () => useAppStore.getState().addNode('folder'))
    action('new-collection', 'New collection', 'create add collection', () => useAppStore.getState().addNode('collection'))

    if (activeId) {
      const doc = documents[activeId]
      if (sending) {
        action('cancel', 'Cancel request', 'stop abort halt', () => cancelRequest(activeId), shortcuts.cancel)
      } else {
        action('send', 'Send request', 'run execute fire', () => toggleRequest(activeId), shortcuts.send)
      }
      action('save', 'Save now', 'persist store write flush disk', () => flushNow(), shortcuts.save)
      action('close', 'Close tab', 'dismiss hide', () => useAppStore.getState().closeRequest(activeId), shortcuts.close)
      action('reveal', 'Reveal in sidebar', 'find locate show tree', () => useAppStore.getState().revealNode(activeId))
      action('copy-url', 'Copy request URL', 'clipboard link', () => void navigator.clipboard.writeText(doc?.url ?? ''))

      const response = store.responses[activeId]
      if (response?.state === 'success') {
        action('copy-body', 'Copy response body', 'clipboard json', () => void navigator.clipboard.writeText(response.body))
        action('clear-response', 'Clear response', 'reset dismiss', () => useAppStore.getState().setResponse(activeId, { state: 'idle' }))
      }
      if (response?.state === 'error') {
        action('retry', 'Retry request', 'again resend', () => void runRequest(activeId), shortcuts.send)
      }

      for (const method of methodOptions) {
        if (doc && doc.method === method) continue
        commands.push({
          id: `method:${method}`,
          group: 'method',
          title: `Set method to ${method}`,
          keywords: `method ${method}`.toLowerCase(),
          method,
          run: () => useAppStore.getState().updateDocument(activeId, { method }),
        })
      }
    }

    action('toggle-sidebar', 'Toggle sidebar', 'hide show collapse panel', () => useAppStore.getState().toggleSidebar(), shortcuts.toggleSidebar)
    action(
      'toggle-split',
      'Toggle split orientation',
      'layout columns rows side by side stacked',
      () => useAppStore.getState().toggleSplitOrientation(),
      shortcuts.toggleSplit,
    )

    // Every request in the tree, searchable by name, method, URL and breadcrumb.
    for (const entry of requests) {
      const doc = documents[entry.requestId]
      if (!doc) continue
      commands.push({
        id: `request:${entry.requestId}`,
        group: 'request',
        title: doc.name,
        subtitle: entry.breadcrumb || doc.url,
        keywords: documentKeywords(doc, entry.breadcrumb),
        method: doc.method,
        run: () => useAppStore.getState().openRequest(entry.requestId),
      })
    }

    return commands
  }, [enabled, tree, documents, tabs, recentIds, activeId, sending])
}
