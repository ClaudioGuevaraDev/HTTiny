import { useEffect, useRef } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import { useAppStore } from '../store'
import { useLocale, useT } from '../language'
import { formatBytes } from '../format'
import { installUpdate, openDownloadPage } from '../updates'
import { isUpdateModalOpen } from '../types'
import type { UpdateState } from '../types'

/**
 * Every state the modal is on screen for. `idle` and `checking` are the silent ones:
 * looking for an update is not worth interrupting anybody, and only its outcome is.
 */
type Shown = Exclude<UpdateState, { state: 'idle' } | { state: 'checking' }>

const isShown = (update: UpdateState): update is Shown => update.state !== 'idle' && update.state !== 'checking'

/**
 * Downloading and installing cannot be interrupted: the app is about to replace itself
 * and there is no half-way state worth leaving somebody in. Closing the modal would
 * hide a transfer that is still running and then quit the app out from under them.
 */
const isBusy = (update: Shown): boolean => update.state === 'downloading' || update.state === 'preparing'

/**
 * Same shell as the settings modal and the command palette, and for the same four
 * reasons: `<dialog>` with `showModal()` supplies a real focus trap, top-layer
 * rendering, focus restoration on close and native Escape. The body only mounts
 * while open, and closing always goes through `dialog.close()` so the DOM and the
 * store cannot desync.
 */
export function UpdateModal() {
  const update = useAppStore(s => s.update)
  const dismissed = useAppStore(s => s.updateDismissed)
  const dismissUpdate = useAppStore(s => s.dismissUpdate)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const open = isUpdateModalOpen(update, dismissed)
  const busy = isShown(update) && isBusy(update)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      // `showModal()` focuses the first focusable control, which is "Later" — and
      // because this dialog opens on its own, with no prior interaction, the browser
      // has no pointer signal to suppress `:focus-visible` and draws a ring on it.
      // Every other modal here is opened by a click, which is why none of them show
      // this. Parking focus on the shell instead keeps the dialog focused — Escape and
      // the tab order still work — while the base ring rule skips `[tabindex='-1']`,
      // so no button comes up looking pre-selected.
      dialog.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="update-dialog"
      // Focusable only programmatically, and excluded from the base focus ring — see
      // the effect above for why the dialog itself takes the initial focus.
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby="update-title"
      onClose={dismissUpdate}
      // Escape reaches a modal dialog as `cancel`, and it is the one dismissal the
      // markup cannot simply omit — so while busy it is refused here instead.
      onCancel={event => {
        if (busy) event.preventDefault()
      }}
      onClick={event => {
        if (!busy && event.target === dialogRef.current) dialogRef.current?.close()
      }}
    >
      {isShown(update) && <UpdateBody update={update} onDismiss={() => dialogRef.current?.close()} />}
    </dialog>
  )
}

function UpdateBody({ update, onDismiss }: { update: Shown; onDismiss: () => void }) {
  const { t } = useT()
  const locale = useLocale()

  // `state` is the discriminant everywhere else in the app, so the copy keys are
  // spliced from it rather than switched on. Flat dotted keys make that typecheck.
  const title = t(`update.${update.state}.title`)
  const body = t(`update.${update.state}.body`, { version: update.version })
  const notes = update.state === 'available' || update.state === 'manual' ? update.notes : ''
  const busy = isBusy(update)

  return (
    <div className="update-shell">
      <div className="update-head">
        <span className="update-icon" aria-hidden="true">
          {update.state === 'manual' || update.state === 'error' ? <Download size={18} /> : <RefreshCw size={18} />}
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

      {busy && (
        <div className="update-progress">
          {/* A native `<progress>`: accessible without hand-rolled ARIA, and omitting
              `value` is exactly the indeterminate state — which is what `preparing`
              needs, and what an unknown total falls back to. */}
          {update.state === 'downloading' && update.total > 0 ? (
            <progress value={update.received} max={update.total} />
          ) : (
            <progress />
          )}
          {update.state === 'downloading' && update.total > 0 && (
            <span className="update-progress-bytes">
              {t('update.progress', { received: formatBytes(update.received, locale), total: formatBytes(update.total, locale) })}
            </span>
          )}
        </div>
      )}

      {!busy && (
        <div className="update-actions">
          <button type="button" className="update-later" onClick={onDismiss}>
            {t('update.later')}
          </button>
          <button
            type="button"
            className="send-btn"
            onClick={() => {
              // Neither call resolves in the normal case: installing ends the process,
              // and opening the browser hands off. Failures come back through the
              // store as an `error` state, so nothing is awaited here.
              if (update.state === 'available') void installUpdate()
              else void openDownloadPage()
            }}
          >
            {update.state === 'available' ? t('update.available.action') : t('update.manual.action')}
          </button>
        </div>
      )}

      {!busy && (
        <button type="button" className="icon-btn update-close" aria-label={t('update.later')} onClick={onDismiss}>
          <X size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
