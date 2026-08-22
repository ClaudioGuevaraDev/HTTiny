import type { Request } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/httpexec'
import type { RequestDocument } from './types'

/**
 * The body half of the `Request` DTO, built from the editor's model.
 *
 * `goExecutor` and `wire.ts` were deliberate duplicates of the same translation — if
 * they disagreed, the code view would describe a request nobody makes — and the body is
 * the part of it with four payload fields and a rule about which one is read. Two
 * hand-written copies of that would drift, so there is one, and it lives here rather
 * than in either caller because neither owns it. `toRequestDTO` below is the rest of
 * the same argument: the whole literal is here and the two callers are one call each.
 *
 * Rows are an editor model: the enable checkbox and the blank trailing row are there
 * so the grid is editable, and neither belongs on the wire. The same filter runs over
 * every grid — params, headers, urlencoded and form alike.
 */
const toBodyDTO = (body: RequestDocument['body']): Pick<Request, 'bodyType' | 'body' | 'form' | 'urlencoded' | 'file'> => ({
  bodyType: body.type,
  body: body.content,
  form: body.form
    .filter(row => row.enabled && row.key.trim())
    .map(row => ({
      kind: row.kind,
      name: row.key.trim(),
      // A file row's typed-in value and a text row's chosen path are both kept in the
      // document — switching a row's kind and back should not lose what was there —
      // so each is cleared on the way out rather than sent as a field Go would have to
      // learn to ignore.
      value: row.kind === 'file' ? '' : row.value,
      path: row.kind === 'file' ? row.path : '',
      contentType: row.contentType.trim(),
    })),
  urlencoded: body.urlencoded.filter(row => row.enabled && row.key.trim()).map(row => ({ key: row.key.trim(), value: row.value })),
  file: { path: body.file.path, contentType: body.file.contentType.trim() },
})

/**
 * The whole `Request` DTO, for both `Send` and `Wire`.
 *
 * One projection rather than a literal at each call site, so the send and the code view
 * cannot describe different requests — the drift the body half above already argued
 * against, applied to the other five fields. Pure: nothing here reads the store, and
 * nothing it returns is written back into `documents`.
 *
 * `id` keys the response bytes Go retains, so `bodyUrl` can point back at them, and it
 * seeds the multipart boundary. `params` is deliberately absent: `replaceQuery` keeps
 * the query string inside `url` as rows are edited, so shipping both would
 * double-encode them.
 */
export const toRequestDTO = (request: RequestDocument): Request => ({
  id: request.id,
  method: request.method,
  url: request.url,
  headers: request.headers.filter(row => row.enabled && row.key.trim()).map(row => ({ key: row.key.trim(), value: row.value })),
  ...toBodyDTO(request.body),
  auth: request.auth,
  timeoutMs: 0,
})
