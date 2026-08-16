import { useEffect, useState } from 'react'

/**
 * The bytes of a byte-backed response, fetched from the asset route Go serves them on.
 *
 * They deliberately do not arrive over the Wails binding — base64 would inflate them by
 * a third, hold them twice in memory and give up the Range requests that let a video
 * seek. The cost of that decision is this hook: anything wanting the actual bytes
 * rather than an `<img src>` has to go and get them.
 *
 * `bytes` is `null` until they land, which is distinct from an empty array. The state
 * carries its own `failed` rather than throwing, because a failure here is a thing to
 * render: a body evicted from the store while its tab sat open is an ordinary outcome,
 * not a bug.
 */
export interface ByteState {
  bytes: Uint8Array | null
  loading: boolean
  failed: boolean
}

/**
 * The url each result belongs to is stored *with* it, so "these bytes are stale" is
 * derived on render rather than written by the effect.
 *
 * That is not a stylistic preference. Resetting to a loading state from inside the
 * effect body means a second render pass every time the url changes, and the React
 * Compiler rejects it outright. Comparing on the way out costs one string compare and
 * makes the transition atomic: there is no frame in which the previous response's
 * bytes are reported for the current url.
 */
interface Fetched extends ByteState {
  url: string
}

const EMPTY: Fetched = { url: '', bytes: null, loading: false, failed: false }

export function useResponseBytes(url: string): ByteState {
  const [fetched, setFetched] = useState<Fetched>(EMPTY)

  useEffect(() => {
    if (!url) return
    // Abort rather than guard with a stale flag: switching tabs mid-download should
    // stop the transfer, not merely ignore it once it lands.
    const controller = new AbortController()
    fetch(url, { signal: controller.signal })
      .then(response => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
      .then(buffer => setFetched({ url, bytes: new Uint8Array(buffer), loading: false, failed: false }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.error('Could not read the retained response body', error)
        setFetched({ url, bytes: null, loading: false, failed: true })
      })
    return () => controller.abort()
  }, [url])

  if (fetched.url === url) return fetched
  return { bytes: null, loading: url !== '', failed: false }
}

/**
 * An SVG as something an `<img>` can load.
 *
 * A data URL rather than an object URL, so there is no handle to revoke and nothing to
 * leak — the string is derived from the source and that is the whole lifecycle. It is
 * also the reason SVG stays on the textual side of the split: an `<img>` never executes
 * script whatever the document contains, which is a guarantee of the element rather
 * than a sanitiser that would have to be kept correct.
 *
 * `encodeURIComponent` rather than base64: `btoa` throws on any character outside
 * Latin-1, and an SVG with a label in Greek or Japanese is not unusual.
 */
export const svgDataUrl = (source: string): string => (source ? `data:image/svg+xml,${encodeURIComponent(source)}` : '')
