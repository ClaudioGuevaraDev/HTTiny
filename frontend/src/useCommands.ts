import { useMemo } from 'react'
import { documentKeywords, flattenRequests, type Command } from './commands'
import type { PlainMessageKey } from './i18n'
import { useT } from './language'
import { flushNow } from './persistence'
import { cancelRequest, runRequest, toggleRequest } from './requestRunner'
import { shortcuts } from './shortcuts'
import { methodOptions, useAppStore } from './store'
import type { UpdateState } from './types'

const EMPTY: Command[] = []

/**
 * Builds the palette's command list from current store state.
 *
 * Every `run` reads `useAppStore.getState()` at call time rather than closing over
 * the values used to build it, so a stale list can never act on stale state.
 */
export function useCommands(enabled: boolean): Command[] {
  // Stable per locale — `translatorFor` is a lookup into a table built once — which is
  // what makes it safe in the dependency array below. A fresh closure per render would
  // rebuild this whole list on every keystroke in the URL bar.
  const { t } = useT()
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
    // `keywords` is a hidden haystack, never rendered — the Spanish catalogue keeps the
    // English synonyms alongside its own, because a developer types `send` and `save`
    // from muscle memory whatever the interface is set to.
    const action = (id: string, title: PlainMessageKey, keywords: PlainMessageKey, run: () => void, shortcut?: readonly string[]) =>
      commands.push({ id: `action:${id}`, group: 'action', title: t(title), keywords: t(keywords).toLowerCase(), shortcut, run })

    action('new-request', 'command.newRequest.title', 'command.newRequest.keywords', () => useAppStore.getState().addNode('request'), shortcuts.newRequest)
    action('new-folder', 'command.newFolder.title', 'command.newFolder.keywords', () => useAppStore.getState().addNode('folder'))
    action('new-collection', 'command.newCollection.title', 'command.newCollection.keywords', () => useAppStore.getState().addNode('collection'))

    if (activeId) {
      const doc = documents[activeId]
      if (sending) {
        action('cancel', 'command.cancel.title', 'command.cancel.keywords', () => cancelRequest(activeId), shortcuts.cancel)
      } else {
        action('send', 'command.send.title', 'command.send.keywords', () => toggleRequest(activeId), shortcuts.send)
      }
      action('save', 'command.save.title', 'command.save.keywords', () => flushNow(), shortcuts.save)
      action('close', 'command.close.title', 'command.close.keywords', () => useAppStore.getState().closeRequest(activeId), shortcuts.close)
      action('reveal', 'command.reveal.title', 'command.reveal.keywords', () => useAppStore.getState().revealNode(activeId))
      action('copy-url', 'command.copyUrl.title', 'command.copyUrl.keywords', () => void navigator.clipboard.writeText(doc?.url ?? ''))

      const response = store.responses[activeId]
      if (response?.state === 'success') {
        action(
          'find-in-response',
          'command.findInResponse.title',
          'command.findInResponse.keywords',
          () => useAppStore.getState().setResponseSearch({ open: true }),
          shortcuts.find,
        )
        action('copy-body', 'command.copyBody.title', 'command.copyBody.keywords', () => void navigator.clipboard.writeText(response.body))
        action('clear-response', 'command.clearResponse.title', 'command.clearResponse.keywords', () =>
          useAppStore.getState().setResponse(activeId, { state: 'idle' }),
        )
      }
      if (response?.state === 'error') {
        action('retry', 'command.retry.title', 'command.retry.keywords', () => void runRequest(activeId), shortcuts.send)
      }

      for (const method of methodOptions) {
        if (doc && doc.method === method) continue
        commands.push({
          id: `method:${method}`,
          group: 'method',
          title: t('command.setMethod.title', { method }),
          keywords: t('command.setMethod.keywords', { method }).toLowerCase(),
          method,
          run: () => useAppStore.getState().updateDocument(activeId, { method }),
        })
      }
    }

    action(
      'toggle-sidebar',
      'command.toggleSidebar.title',
      'command.toggleSidebar.keywords',
      () => useAppStore.getState().toggleSidebar(),
      shortcuts.toggleSidebar,
    )
    action(
      'toggle-split',
      'command.toggleSplit.title',
      'command.toggleSplit.keywords',
      () => useAppStore.getState().toggleSplitOrientation(),
      shortcuts.toggleSplit,
    )
    action('settings', 'command.settings.title', 'command.settings.keywords', () => useAppStore.getState().openSettings(), shortcuts.settings)
    action('zoom-in', 'command.zoomIn.title', 'command.zoomIn.keywords', () => useAppStore.getState().zoomIn(), shortcuts.zoomIn)
    action('zoom-out', 'command.zoomOut.title', 'command.zoomOut.keywords', () => useAppStore.getState().zoomOut(), shortcuts.zoomOut)
    action('zoom-reset', 'command.zoomReset.title', 'command.zoomReset.keywords', () => useAppStore.getState().resetZoom(), shortcuts.zoomReset)

    // Development only, and stripped from a production bundle by the `import.meta.env.DEV`
    // check the same way the catalogue's placeholder audit is.
    //
    // The update modal is otherwise only reachable by actually publishing a newer release,
    // which is a slow and irreversible way to look at a button. Titles are literals rather
    // than catalogue keys on purpose: a developer tool that never ships is not copy, and
    // adding keys for it would mean translating strings no user can reach.
    if (import.meta.env.DEV) {
      const preview = (id: string, title: string, state: UpdateState) =>
        commands.push({
          id: `dev:${id}`,
          group: 'action',
          title,
          keywords: 'dev preview update modal',
          run: () => useAppStore.getState().setUpdate(state),
        })

      const version = '9.9.9'
      const notes = 'A fake release, for looking at the dialog.\n\n- One bullet\n- Another one'
      preview('update-available', 'Preview update · available', { state: 'available', version, notes })
      preview('update-downloading', 'Preview update · downloading', { state: 'downloading', version, received: 3_100_000, total: 7_200_000 })
      preview('update-preparing', 'Preview update · preparing', { state: 'preparing', version })
      preview('update-manual', 'Preview update · manual download', { state: 'manual', version, notes })
      preview('update-error', 'Preview update · error', { state: 'error', version, code: 'UPDATE_DOWNLOAD_FAILED', detail: 'fake failure' })
    }

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
  }, [enabled, tree, documents, tabs, recentIds, activeId, sending, t])
}
