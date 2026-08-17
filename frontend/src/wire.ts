import { HTTPService } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/httpexec'
import type { WireResult } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/httpexec'
import { fromResult, snippetFor } from './snippets'
import type { RequestDocument } from './types'

/**
 * Asks Go what it would send.
 *
 * The one bridge to `HTTPService.Wire`, so the row-model-to-DTO translation exists once.
 * It is the same translation `goExecutor` performs for a send, and deliberately so: if the
 * two disagreed, the code view would describe a request nobody makes.
 *
 * Lives outside React because two callers need it and only one of them is a component —
 * the palette's "Copy as curl" runs from a command, with nowhere to hang a hook.
 */
export const wireFor = (request: RequestDocument): Promise<WireResult> =>
  HTTPService.Wire({
    id: request.id,
    method: request.method,
    url: request.url,
    // Rows are an editor model: the enable checkbox and the blank trailing row are there
    // so the grid is editable, and neither belongs on the wire.
    headers: request.headers.filter(row => row.enabled && row.key.trim()).map(row => ({ key: row.key.trim(), value: row.value })),
    bodyType: request.body.type,
    body: request.body.content,
    auth: request.auth,
    timeoutMs: 0,
  })

/**
 * Puts one target's snippet on the clipboard without opening the code view.
 *
 * Best effort, like `goExecutor.release`: this runs from a command palette entry that has
 * already closed by the time the answer arrives, so there is nowhere to report to. A
 * failure leaves the clipboard alone rather than throwing into a promise nobody awaits.
 *
 * Secrets are **not** redacted here. The point of the shortcut is a snippet that runs when
 * pasted, and the toggle that hides them is a deliberate act taken in the modal.
 */
export const copySnippet = async (request: RequestDocument, target: Parameters<typeof snippetFor>[0]): Promise<void> => {
  try {
    const answer = await wireFor(request)
    if (!answer.ok) return
    await navigator.clipboard.writeText(snippetFor(target, fromResult(answer), false))
  } catch (error) {
    console.warn('Could not copy the request as a snippet', error)
  }
}
