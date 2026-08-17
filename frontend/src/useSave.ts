import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Writing something to a file, with an acknowledgement.
 *
 * The twin of `useCopy`, and for the same reason it exists: an action whose only
 * evidence is a native dialog closing is indistinguishable from an action that did
 * nothing. `status` drives both the button's glyph and a polite live region.
 *
 * The third outcome is what makes this its own hook rather than a boolean. Dismissing
 * a save dialog is the most ordinary thing a person can do with one, so a cancel
 * returns to `idle` in silence — reporting it as a failure would put an error in
 * front of someone who simply changed their mind. `saveFile` therefore resolves to
 * `false` for both cancel and failure, and only the latter is announced.
 */
export type SaveStatus = 'idle' | 'saved' | 'failed'

export function useSave(resetAfter = 2000) {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const save = useCallback(
    (write: () => Promise<{ ok: boolean; cancelled: boolean }>) => {
      window.clearTimeout(timer.current)
      write().then(
        result => {
          // A cancel leaves the button exactly as it was: no tick, no cross, no
          // announcement. Nothing happened, and saying so would be noise.
          if (result.cancelled) return
          setStatus(result.ok ? 'saved' : 'failed')
          timer.current = window.setTimeout(() => setStatus('idle'), resetAfter)
        },
        (error: unknown) => {
          console.error('Could not save the response body', error)
          setStatus('failed')
          timer.current = window.setTimeout(() => setStatus('idle'), resetAfter)
        },
      )
    },
    [resetAfter],
  )

  return { status, save }
}
