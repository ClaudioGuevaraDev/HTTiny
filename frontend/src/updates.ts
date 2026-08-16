import { Call } from '@wailsio/runtime'
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
 * Runs the whole flow once, at startup.
 *
 * Silence is the point: no update, no network, no backend and a version the user has
 * already skipped all end with nothing on screen. The modal is only ever opened for a
 * decision — install now, or go and download it.
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
  if (useAppStore.getState().skippedVersion === version) {
    store.setUpdate({ state: 'idle' })
    return
  }

  // Linux: never download. A .deb or .rpm belongs to the package manager, and the
  // AppImage is one file rather than the loose executable the updater swaps.
  if (!canSelfUpdate) {
    store.setUpdate({ state: 'manual', version, notes })
    return
  }

  store.setUpdate({ state: 'downloading', version })
  const downloaded = await call(() => UpdateService.Download())
  if (!downloaded.ok) {
    // The download is the one failure worth surfacing: an update exists and we
    // could not fetch it, so offer the manual route instead of going quiet.
    store.setUpdate({ state: 'error', version, code: downloaded.errorCode, detail: downloaded.errorText })
    return
  }
  store.setUpdate({ state: 'ready', version, notes })
}

/**
 * Installs what was staged. On success the process is already on its way out, so
 * there is nothing to report; only a failure comes back, and it falls through to the
 * manual download like any other.
 */
export const applyUpdate = async (): Promise<void> => {
  const store = useAppStore.getState()
  const current = store.update
  const version = 'version' in current ? current.version : ''

  const applied = await call(() => UpdateService.Apply())
  if (!applied.ok) store.setUpdate({ state: 'error', version, code: applied.errorCode, detail: applied.errorText })
}

/** Opens the releases page in the user's browser. */
export const openDownloadPage = async (): Promise<void> => {
  await call(() => UpdateService.OpenDownloadPage())
}
