import { RequestFailure, resolveError } from './errors'
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
    const [message, fallback] = resolveError(code)
    // The executor's own diagnostic wins over the curated copy when there is one:
    // "connectex: no connection could be made" locates the problem in a way that
    // "nothing is listening on that host and port" cannot.
    const detail = (error instanceof RequestFailure && error.detail) || fallback
    useAppStore.getState().setResponse(id, { state: 'error', code, message, detail })
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
