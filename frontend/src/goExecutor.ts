import { Call, CancelError } from '@wailsio/runtime'
import { HTTPService } from '../bindings/github.com/ClaudioGuevaraDev/HTTiny/internal/httpexec'
import type { KeyValue } from '../bindings/github.com/ClaudioGuevaraDev/HTTiny/internal/httpexec'
import { RequestFailure } from './errors'
import type { KeyValueRow, RequestExecutor, ResponseFormat } from './types'

/**
 * Rows are an editor model: the checkbox and the blank trailing row exist so the
 * grid is editable, and neither belongs on the wire.
 */
const toPairs = (rows: readonly KeyValueRow[]): KeyValue[] =>
  rows.filter(row => row.enabled && row.key.trim()).map(row => ({ key: row.key.trim(), value: row.value }))

/**
 * Response headers are display-only, but they still need React keys. The name
 * alone is not unique — `Set-Cookie` legitimately repeats — so the index goes into
 * the id.
 */
const toRows = (pairs: readonly KeyValue[]): KeyValueRow[] =>
  pairs.map((pair, index) => ({ id: `${index}:${pair.key}`, enabled: true, key: pair.key, value: pair.value, description: '' }))

const FORMATS: readonly ResponseFormat[] = ['json', 'html', 'xml', 'text', 'binary']
const toFormat = (value: string): ResponseFormat => (FORMATS as readonly string[]).includes(value) ? (value as ResponseFormat) : 'text'

/**
 * Executes requests in the Go process over the Wails binding.
 *
 * Everything the network cares about is resolved on the Go side — the
 * `Authorization` header, the default `Content-Type` for a JSON body, redirect and
 * timeout policy — so this module is only a translation between the editor's row
 * model and the binding's DTOs.
 *
 * `params` are deliberately not sent: `replaceQuery` keeps the query string inside
 * `url` as rows are edited, so shipping both would double-encode them.
 */
export const goExecutor: RequestExecutor = {
  async execute(request, signal) {
    signal.throwIfAborted()

    let result
    try {
      // `cancelOn` is the runtime's own AbortSignal bridge: it cancels the call,
      // which cancels the Go context, which aborts the socket. Aborting here is a
      // real network cancellation, not just the UI looking away.
      result = await HTTPService.Send({
        method: request.method,
        url: request.url,
        headers: toPairs(request.headers),
        bodyType: request.body.type,
        body: request.body.content,
        auth: request.auth,
        timeoutMs: 0,
      }).cancelOn(signal)
    } catch (error) {
      // `runRequest` discards results for an aborted controller, so a cancellation
      // just needs to stop unwinding here.
      if (error instanceof CancelError) throw error
      // Send returns no Go error, so a RuntimeError means the service itself
      // failed — worth surfacing verbatim. Anything else means the call never
      // reached a backend at all, which is what `pnpm run dev` in a plain browser
      // looks like: there is no Wails runtime behind the page.
      if (error instanceof Call.RuntimeError) throw new RequestFailure('UNKNOWN', error.message)
      console.error('Wails binding call failed', error)
      throw new RequestFailure('BACKEND_UNAVAILABLE')
    }

    if (!result.ok) throw new RequestFailure(result.errorCode, result.errorText)

    const response = result.response
    return {
      state: 'success',
      status: response.status,
      statusText: response.statusText,
      time: response.timeMs,
      sizeBytes: response.sizeBytes,
      body: response.body,
      // Go slices cross the binding as `T[] | null`, so an empty header map
      // arrives as null rather than [].
      headers: toRows(response.headers ?? []),
      contentType: response.contentType,
      format: toFormat(response.format),
      truncated: response.truncated,
    }
  },
}
