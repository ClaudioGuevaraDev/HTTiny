import type { RequestExecutor } from './types'

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(new DOMException('Cancelled', 'AbortError'))
      },
      { once: true },
    )
  })

export const mockExecutor: RequestExecutor = {
  async execute(request, signal) {
    if (!/^https?:\/\/\S+/i.test(request.url)) throw new Error('INVALID_URL')
    await wait(650, signal)
    const url = request.url.toLowerCase()
    if (url.includes('timeout')) throw new Error('TIMEOUT')
    if (url.includes('dns-error')) throw new Error('DNS_ERROR')
    if (url.includes('refused')) throw new Error('CONNECTION_REFUSED')
    const status = request.method === 'POST' ? 201 : request.method === 'DELETE' ? 204 : 200
    const body =
      status === 204
        ? ''
        : JSON.stringify(
            {
              ok: true,
              request: { method: request.method, url: request.url },
              data:
                request.method === 'GET'
                  ? [
                      { id: 1, name: 'Maya Chen', role: 'developer', active: true },
                      { id: 2, name: 'Noah Williams', role: 'designer', active: true },
                      { id: 3, name: 'Sofia Rossi', role: 'engineer', active: false },
                    ]
                  : { id: 42, created: request.method === 'POST' },
              meta: { generatedBy: 'HTTiny mock', timestamp: new Date().toISOString() },
            },
            null,
            2,
          )
    return {
      state: 'success',
      status,
      statusText: status === 201 ? 'Created' : status === 204 ? 'No Content' : 'OK',
      time: 124 + request.url.length,
      sizeBytes: body ? new Blob([body]).size : 0,
      body,
      headers: [
        { id: 'rh1', enabled: true, key: 'content-type', value: 'application/json; charset=utf-8', description: '' },
        { id: 'rh2', enabled: true, key: 'x-request-id', value: 'httiny_mock_8f29c', description: '' },
        { id: 'rh3', enabled: true, key: 'cache-control', value: 'no-store', description: '' },
      ],
    }
  },
}
