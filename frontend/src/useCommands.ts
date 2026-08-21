import { useMemo } from 'react'
import { documentKeywords, flattenRequests, type Command } from './commands'
import { applicableEnvironmentId } from './environments'
import type { PlainMessageKey } from './i18n'
import { useT } from './language'
import { flushNow } from './persistence'
import { cancelRequest, runRequest, saveResponseBody, toggleRequest } from './requestRunner'
import { shortcuts } from './shortcuts'
import { collectionInPlay, methodOptions, useAppStore } from './store'
import { isByteFormat } from './types'
import { copySnippet } from './wire'

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
  const environments = useAppStore(s => s.environments)
  const applicable = useAppStore(applicableEnvironmentId)
  // Which collection the rows act on. Needed for the subtitle *and* as the gate: with no
  // collections `setActiveEnvironment` is a no-op, and a palette row that does nothing is
  // worse than an absent one — the same reason the picker is disabled there.
  const scope = useAppStore(collectionInPlay)
  const scopeName = useAppStore(s => (scope ? (s.tree.find(node => node.id === scope)?.name ?? '') : ''))
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
      action('code', 'command.code.title', 'command.code.keywords', () => useAppStore.getState().openCode(), shortcuts.code)
      // Straight to the clipboard, skipping the modal — the one target common enough that
      // picking it from a list is a step rather than a choice.
      if (doc) action('copy-curl', 'command.copyCurl.title', 'command.copyCurl.keywords', () => void copySnippet(doc, 'curl'))

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
        // Reaches the same Go call the toolbar button does. The acknowledgement is
        // the button's job, so from here a cancel and a success look alike — which is
        // right for a palette entry: the dialog it opens is the feedback.
        action('save-body', 'command.saveBody.title', 'command.saveBody.keywords', () => {
          void saveResponseBody({
            id: activeId,
            text: isByteFormat(response.format) ? '' : response.body,
            filename: response.filename,
            title: t('response.save.dialog'),
          })
        })
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
    action(
      'environments',
      'command.environments.title',
      'command.environments.keywords',
      () => useAppStore.getState().openEnvironments(),
      shortcuts.environments,
    )

    // One row per environment, the shape the method loop above uses — skipping the one
    // already applying to the collection in play, and offering "no environment" only when
    // there is one to turn off. Group `'action'` rather than a group of their own: a new
    // `CommandGroup` means touching four other places, which the seven method rows earn
    // and two or three environments do not, and `'action'` is what the `>` filter
    // searches.
    //
    // The collection goes in the `subtitle`, which is where the navigation and request
    // rows already put "which thing this is" — no palette row names the thing it acts on
    // in its *title* (`command.setMethod.title` is 'Set method to {method}'), and the
    // `action` helper takes a `PlainMessageKey`, so a slot in `command.noEnvironment.title`
    // would break that call at compile time. It goes in `keywords` too, so typing a
    // collection surfaces the environments you can point it at.
    if (scope) {
      for (const env of environments) {
        if (env.id === applicable) continue
        commands.push({
          id: `env:${env.id}`,
          group: 'action',
          title: t('command.useEnvironment.title', { name: env.name }),
          subtitle: scopeName,
          keywords: `${t('command.useEnvironment.keywords', { name: env.name })} ${scopeName}`.toLowerCase(),
          run: () => useAppStore.getState().setActiveEnvironment(env.id),
        })
      }
      if (applicable) {
        action('no-environment', 'command.noEnvironment.title', 'command.noEnvironment.keywords', () =>
          useAppStore.getState().setActiveEnvironment(null),
        )
      }
    }
    action('zoom-in', 'command.zoomIn.title', 'command.zoomIn.keywords', () => useAppStore.getState().zoomIn(), shortcuts.zoomIn)
    action('zoom-out', 'command.zoomOut.title', 'command.zoomOut.keywords', () => useAppStore.getState().zoomOut(), shortcuts.zoomOut)
    action('zoom-reset', 'command.zoomReset.title', 'command.zoomReset.keywords', () => useAppStore.getState().resetZoom(), shortcuts.zoomReset)

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
  }, [enabled, tree, documents, tabs, recentIds, activeId, environments, applicable, scope, scopeName, sending, t])
}
