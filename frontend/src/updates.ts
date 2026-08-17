import { Call, Events, Updater } from '@wailsio/runtime'
import { Service as UpdateService } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/updates'
import type { Result } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/updates'
import { useAppStore } from './store'

/**
 * The seam between the update flow and the bound Go service, in the same shape as
 * `goExecutor.ts`: every call comes back as a `Result` carrying a stable code, and the
 * absence of a Wails runtime is turned into `BACKEND_UNAVAILABLE` rather than an
 * exception nobody catches.
 *
 * Under `pnpm run dev` in a plain browser there is no backend at all, so every call
 * lands there and the whole feature simply never appears — which is the right
 * behaviour for a check nobody asked for.
 */
const UNAVAILABLE: Result = { ok: false, errorCode: 'BACKEND_UNAVAILABLE', errorText: '', update: null }

const call = async (fn: () => Promise<Result>): Promise<Result> => {
  try {
    return await fn()
  } catch (error) {
    // A RuntimeError means the service ran and failed, which is worth reporting
    // verbatim. Anything else means the call never reached a backend.
    if (error instanceof Call.RuntimeError) return { ok: false, errorCode: 'UPDATE_CHECK_FAILED', errorText: error.message, update: null }
    return UNAVAILABLE
  }
}

/**
 * The payload of `wails:updater:download-progress`. Declared here because the runtime
 * types every event's `data` as `any` — this is untrusted input in the same sense the
 * workspace file is, so it is read defensively rather than asserted.
 */
const readProgress = (data: unknown): { received: number; total: number } => {
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)
  return { received: num(record.written), total: num(record.total) }
}

/**
 * Looks for a new version, once, at startup.
 *
 * Nothing is downloaded here: the transfer is what the user is agreeing to when they
 * press the button, and pulling several megabytes on every launch for an update most
 * launches will not install is bandwidth nobody asked to spend.
 *
 * Silence is the other half of it. No update, no network and no backend all end with
 * nothing on screen; the modal only ever opens to ask something.
 */
export const checkForUpdate = async (): Promise<void> => {
  const store = useAppStore.getState()
  store.setUpdate({ state: 'checking' })

  const checked = await call(() => UpdateService.Check())
  if (!checked.ok || !checked.update) {
    // A failed check is not worth a modal. The app works; the user did not ask.
    store.setUpdate({ state: 'idle' })
    return
  }

  const { version, notes, canSelfUpdate } = checked.update
  // Linux: never download. A .deb or .rpm belongs to the package manager, and the
  // AppImage is one file rather than the loose executable the updater swaps.
  store.setUpdate({ state: canSelfUpdate ? 'available' : 'manual', version, notes })
}

/**
 * Downloads, verifies and installs, reporting progress along the way. On success the
 * process is already on its way out, so only a failure ever comes back — and it lands
 * in the same error state that offers the manual download.
 *
 * The event subscription lives here rather than in a `useEffect`: the modal body only
 * mounts while the dialog is open, and the download has to outlive any remount. Wails
 * throttles the progress event to ~10 Hz itself, so there is nothing to rate-limit.
 */
export const installUpdate = async (): Promise<void> => {
  const store = useAppStore.getState()
  const current = store.update
  if (!('version' in current)) return
  const { version } = current

  store.setUpdate({ state: 'downloading', version, received: 0, total: 0 })

  const offProgress = Events.On(Updater.Events.DownloadProgress, event => {
    // Ignore late ticks once the flow has moved on, so a trailing event cannot drag
    // the modal back from `preparing` to a bar at 100%.
    if (useAppStore.getState().update.state !== 'downloading') return
    const { received, total } = readProgress(event.data)
    useAppStore.getState().setUpdate({ state: 'downloading', version, received, total })
  })
  // Verification and unpacking emit no progress at all, and `Download` does not resolve
  // until they finish. Without this the bar would sit at 100% looking hung.
  const offVerifying = Events.On(Updater.Events.Verifying, () => {
    useAppStore.getState().setUpdate({ state: 'preparing', version })
  })

  let downloaded: Result
  try {
    downloaded = await call(() => UpdateService.Download())
  } finally {
    offProgress()
    offVerifying()
  }

  if (!downloaded.ok) {
    store.setUpdate({ state: 'error', version, code: downloaded.errorCode, detail: downloaded.errorText })
    return
  }

  // Installing quits the app, so this state is the last thing drawn. Set it anyway:
  // the download may have finished without a `verifying` event ever arriving.
  useAppStore.getState().setUpdate({ state: 'preparing', version })
  const applied = await call(() => UpdateService.Apply())
  if (!applied.ok) useAppStore.getState().setUpdate({ state: 'error', version, code: applied.errorCode, detail: applied.errorText })
}

/** Opens the releases page in the user's browser. */
export const openDownloadPage = async (): Promise<void> => {
  await call(() => UpdateService.OpenDownloadPage())
}
