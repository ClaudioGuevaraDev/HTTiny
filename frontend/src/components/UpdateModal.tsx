import { useEffect, useRef } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import { useAppStore } from '../store'
import { useT } from '../language'
import { applyUpdate, openDownloadPage } from '../updates'
import type { UpdateState } from '../types'

/**
 * The three states worth interrupting for. Checking and downloading happen without
 * a word, so the modal only ever opens to ask a question — which is what "tell me
 * before restarting" means: the work is done, the decision is not.
 */
type Decision = Extract<UpdateState, { state: 'ready' | 'manual' | 'error' }>

const isDecision = (update: UpdateState): update is Decision =>
  update.state === 'ready' || update.state === 'manual' || update.state === 'error'

/**
 * Same shell as the settings modal and the command palette, and for the same four
 * reasons: `<dialog>` with `showModal()` supplies a real focus trap, top-layer
 * rendering, focus restoration on close and native Escape. The body only mounts
 * while open, and closing always goes through `dialog.close()` so the DOM and the
 * store cannot desync.
 */
export function UpdateModal() {
  const update = useAppStore(s => s.update)
  const dismissUpdate = useAppStore(s => s.dismissUpdate)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const open = isDecision(update)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="update-dialog"
      aria-modal="true"
      aria-labelledby="update-title"
      onClose={dismissUpdate}
      onClick={event => {
        if (event.target === dialogRef.current) dialogRef.current?.close()
      }}
    >
      {isDecision(update) && <UpdateBody update={update} onDismiss={() => dialogRef.current?.close()} />}
    </dialog>
  )
}

function UpdateBody({ update, onDismiss }: { update: Decision; onDismiss: () => void }) {
  const { t } = useT()
  const skipUpdate = useAppStore(s => s.skipUpdate)

  // `state` is the discriminant everywhere else in the app, so the copy keys are
  // spliced from it rather than switched on. Flat dotted keys make that typecheck.
  const title = t(`update.${update.state}.title`)
  const body = t(`update.${update.state}.body`, { version: update.version })
  const notes = update.state === 'error' ? '' : update.notes

  // Only a staged, verified update can be installed in place. The other two states
  // send the user to the releases page, which is the same escape hatch either way.
  const install = update.state === 'ready'

  return (
    <div className="update-shell">
      <div className="update-head">
        <span className="update-icon" aria-hidden="true">
          {install ? <RefreshCw size={18} /> : <Download size={18} />}
        </span>
        <div>
          <h2 id="update-title">{title}</h2>
          <p className="update-body">{body}</p>
        </div>
      </div>

      {notes && (
        <section className="update-notes">
          <h3>{t('update.notes')}</h3>
          {/* Release notes are the raw text from the manifest, not copy this app
              owns, so they are rendered verbatim and never translated. */}
          <pre>{notes}</pre>
        </section>
      )}

      <div className="update-actions">
        <button type="button" className="link-btn" onClick={skipUpdate}>
          {t('update.skip')}
        </button>
        <span className="update-actions-gap" />
        <button type="button" className="update-later" onClick={onDismiss}>
          {t('update.later')}
        </button>
        <button
          type="button"
          className="send-btn"
          autoFocus
          onClick={() => {
            // Neither call resolves in the normal case: installing ends the process,
            // and opening the browser hands off. Failures come back through the
            // store as an `error` state, so nothing is awaited here.
            if (install) void applyUpdate()
            else void openDownloadPage()
          }}
        >
          {install ? t('update.ready.action') : t('update.manual.action')}
        </button>
      </div>

      <button type="button" className="icon-btn update-close" aria-label={t('update.later')} onClick={onDismiss}>
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  )
}
