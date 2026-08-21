import { useEffect, useState } from 'react'
import { Call } from '@wailsio/runtime'
import { environmentIdFor } from './environments'
import { fromResult, type Wire } from './snippets'
import { useAppStore } from './store'
import type { RequestDocument } from './types'
import { wireFor } from './wire'

/**
 * The resolved request, straight from Go.
 *
 * Not a second resolver in TypeScript, and that is why this hook exists at all. Everything
 * the wire format depends on — the percent-encoding of the query, the header precedence,
 * the `User-Agent` and `Content-Type` defaults, the `Authorization` the Auth panel builds
 * — is decided in `internal/httpexec`, and a copy of those rules over here would drift the
 * first time one of them changed. So the code view asks rather than guessing.
 *
 * `WireState` is a small union rather than a value plus two flags, for the same reason
 * `ResponseSnapshot` is one: the modal branches on it exhaustively.
 */
export type WireState = { state: 'loading' } | { state: 'ready'; wire: Wire } | { state: 'failed'; code: string; detail: string } | { state: 'unavailable' }

export function useWire(request: RequestDocument | undefined): WireState {
  const [result, setResult] = useState<WireState>({ state: 'loading' })
  // `{{variables}}` are resolved inside `wireFor`, and neither of these is part of
  // `request` — so without them in the dependency list the code view would keep showing
  // the previous environment's snippet until the next keystroke.
  //
  // Keyed by **this request**, not by whatever is active: `wireFor` resolves through
  // `resolveFor(request.id)`, so the dependency has to ask the same question the resolver
  // does or the two would disagree about which collection's environment is in force.
  // Both are stable: the array only changes identity when an environment is edited, and
  // the id is a string.
  const environments = useAppStore(s => s.environments)
  const environmentId = useAppStore(s => environmentIdFor(s, request?.id))

  // Re-resolved on every edit to the request, so the snippet follows the URL bar as it is
  // typed. `request` is a fresh object per store update, so identity is the right trigger.
  useEffect(() => {
    if (!request) return
    let live = true
    wireFor(request).then(
      answer => {
        if (!live) return
        setResult(answer.ok ? { state: 'ready', wire: fromResult(answer) } : { state: 'failed', code: answer.errorCode, detail: answer.errorText })
      },
      (error: unknown) => {
        if (!live) return
        // A RuntimeError means the service itself failed and is worth showing verbatim.
        // Anything else means the call never reached a backend at all, which is what
        // `pnpm run dev` in a plain browser looks like: there is no Wails runtime behind
        // the page, and no request would send either.
        if (error instanceof Call.RuntimeError) setResult({ state: 'failed', code: 'UNKNOWN', detail: error.message })
        else setResult({ state: 'unavailable' })
      },
    )
    return () => {
      live = false
    }
  }, [request, environments, environmentId])

  return request ? result : { state: 'loading' }
}
