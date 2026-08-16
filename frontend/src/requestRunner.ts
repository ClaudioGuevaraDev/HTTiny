import { RequestFailure } from './errors'
import { goExecutor } from './goExecutor'
import { useAppStore } from './store'
import type { RequestExecutor } from './types'

/**
 * Owns request execution and the in-flight AbortController registry.
 *
 * This exists so that the four surfaces that can start or stop a request — the Send
 * button, Ctrl+Enter, the command palette and the response placeholders — all go
 * through one code path and cannot diverge.
 *
 * The executor is a variable rather than a direct import so that a second
 * implementation can be swapped in without touching any call site. Today there is
 * one: `goExecutor`, which runs the request in the Go process.
 *
 * Module-level state is reset by HMR, which orphans controllers during a hot reload
 * in dev. That is an accepted dev-only edge rather than something worth engineering
 * around.
 */
let executor: RequestExecutor = goExecutor
const controllers = new Map<string, AbortController>()

export const setRequestExecutor = (next: RequestExecutor): void => {
  executor = next
}

export async function runRequest(id: string): Promise<void> {
  const state = useAppStore.getState()
  // Read the document at call time rather than closing over it: the previous
  // implementation captured whatever `document` existed in the render that built
  // the handler, so a request could be sent with stale headers or URL.
  const request = state.documents[id]
  if (!request || controllers.has(id)) return

  const controller = new AbortController()
  controllers.set(id, controller)
  state.setResponse(id, { state: 'loading', startedAt: Date.now() })

  try {
    const result = await executor.execute(request, controller.signal)
    if (!controller.signal.aborted) useAppStore.getState().setResponse(id, result)
  } catch (error) {
    if (controller.signal.aborted) return
    const code = error instanceof RequestFailure ? error.code : error instanceof Error ? error.message : 'UNKNOWN'
    // Only the code and the raw diagnostic are recorded. The prose is resolved from the
    // code where it is rendered, so a failure on screen follows a change of language
    // instead of being frozen in whichever one it happened in. `errors.ts` owns the
    // rule about which of the two wins.
    const detail = (error instanceof RequestFailure && error.detail) || ''
    useAppStore.getState().setResponse(id, { state: 'error', code, detail })
  } finally {
    controllers.delete(id)
  }
}

export function cancelRequest(id: string): void {
  const controller = controllers.get(id)
  if (!controller) return
  controller.abort()
  controllers.delete(id)
  useAppStore.getState().setResponse(id, { state: 'idle' })
}

export function toggleRequest(id: string): void {
  if (controllers.has(id)) cancelRequest(id)
  else void runRequest(id)
}

/**
 * Tells Go it can stop holding the bytes of a response the UI has thrown away.
 *
 * A subscriber rather than a call at each discard site, for the reason the autosave
 * subscriber exists: there are four ways to clear a response and two to delete a
 * request, and one of them will be added later without this being remembered.
 *
 * Deliberately *not* triggered by closing a tab. The store's own comment is explicit
 * that a closed tab keeps its response — finding it still there when you reopen the
 * tab is a feature — and releasing the bytes would leave that reopened tab showing a
 * broken image beside an intact status line. Only a response that has genuinely been
 * discarded is released here; the store's 64 MiB ceiling handles everything else.
 *
 * Installed from `main.tsx` rather than on import, so the module stays side-effect
 * free and the subscription's lifetime is visible where the rest of the boot is.
 */
export function installBodyRelease(): void {
  useAppStore.subscribe((state, prev) => {
    if (state.responses === prev.responses) return
    for (const [id, before] of Object.entries(prev.responses)) {
      // Only byte-backed responses ever held anything; releasing an id Go has nothing
      // for is harmless, but checking keeps the IPC quiet on ordinary JSON traffic.
      if (before.state !== 'success' || !before.bodyUrl) continue
      const after = state.responses[id]
      if (after === before) continue
      // A fresh success for the same request replaces the bytes in Go on its own —
      // `put` evicts the previous entry — so only a discard needs saying.
      if (after?.state === 'success') continue
      void executor.release?.(id)
    }
  })
}
