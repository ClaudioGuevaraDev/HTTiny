import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Copy-to-clipboard with an acknowledgement.
 *
 * The two copy buttons in the response pane used to call `navigator.clipboard.writeText`
 * and nothing else: no visual change, no announcement, and a rejected promise — which is
 * what a denied clipboard permission produces — vanished into a floating `void`. Pressing
 * the button and pressing nothing at all looked identical.
 *
 * `status` drives both the visible label and a polite live region, so the confirmation
 * reaches a screen reader as well as the eye.
 */
export function useCopy(resetAfter = 1500) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = useCallback(
    (text: string) => {
      window.clearTimeout(timer.current)
      navigator.clipboard.writeText(text).then(
        () => setStatus('copied'),
        () => setStatus('failed'),
      )
      timer.current = window.setTimeout(() => setStatus('idle'), resetAfter)
    },
    [resetAfter],
  )

  return { status, copy }
}
