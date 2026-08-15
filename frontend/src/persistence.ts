import { Service as WorkspaceService } from '../bindings/github.com/ClaudioGuevaraDev/HTTiny/internal/workspace'
import { useAppStore } from './store'
import type { RequestDocument } from './types'
import { PREFS_VERSION, WORKSPACE_VERSION, readCollapsed, readPrefs, readWorkspace, toPrefsFile, toWorkspaceFile } from './workspaceFile'

/**
 * Disk persistence: hydrate once at startup, then autosave.
 *
 * Deliberately not zustand's `persist` middleware. That is shaped around a
 * synchronous localStorage-like store, and it cannot express two files with
 * different debounce windows, a separate credential store, or a load that must
 * complete before the first render.
 */

// A trailing debounce alone never fires while a key is held down in the body
// editor, so the ceiling bounds how much continuous typing a hard kill can cost.
const WORKSPACE_DEBOUNCE_MS = 600
const WORKSPACE_MAX_WAIT_MS = 2000
// Layout changes come from pointer drags, which end on their own.
const PREFS_DEBOUNCE_MS = 400
// A hung IPC should degrade to an in-memory session, not an app that never paints.
const HYDRATE_TIMEOUT_MS = 2000

type Writer = { schedule: (payload: string) => void; flush: () => void }

function createWriter(write: (payload: string) => Promise<void>, debounceMs: number, maxWaitMs: number): Writer {
  let timer: number | undefined
  let firstDirtyAt = 0
  let pending: string | null = null

  const run = () => {
    timer = undefined
    firstDirtyAt = 0
    const payload = pending
    if (payload === null) return
    pending = null
    useAppStore.getState().setSaveState('saving')
    write(payload).then(
      () => useAppStore.getState().setSaveState('saved'),
      (error: unknown) => {
        console.error('[persistence] write failed', error)
        useAppStore.getState().setSaveState('error')
      },
    )
  }

  return {
    schedule(payload) {
      pending = payload
      const now = Date.now()
      if (!firstDirtyAt) firstDirtyAt = now
      if (timer !== undefined) clearTimeout(timer)
      const wait = maxWaitMs > 0 ? Math.min(debounceMs, Math.max(0, firstDirtyAt + maxWaitMs - now)) : debounceMs
      timer = window.setTimeout(run, wait)
      useAppStore.getState().setSaveState('pending')
    },
    flush() {
      if (timer !== undefined) clearTimeout(timer)
      run()
    },
  }
}

const workspaceWriter = createWriter(payload => WorkspaceService.SaveWorkspace(payload, WORKSPACE_VERSION), WORKSPACE_DEBOUNCE_MS, WORKSPACE_MAX_WAIT_MS)
const prefsWriter = createWriter(payload => WorkspaceService.SavePrefs(payload, PREFS_VERSION), PREFS_DEBOUNCE_MS, 0)

/** Requests whose credentials belong in the OS credential store. */
const secretsOf = (documents: Record<string, RequestDocument>) =>
  Object.values(documents)
    .filter(doc => doc.auth.type !== 'none' && (doc.auth.token || doc.auth.password))
    .map(doc => ({ id: doc.id, token: doc.auth.token, password: doc.auth.password }))

let secretsTimer: number | undefined
let lastSecrets = ''

/**
 * Only touches the credential store when the credentials themselves changed.
 *
 * Without the signature check every keystroke in the URL bar would queue a write to
 * Credential Manager / Keychain, which is far more expensive than a file write and
 * has nothing to do with what was edited. The id list is part of the signature
 * because deleting a request also has to delete its entry.
 */
const secretsSignature = (documents: Record<string, RequestDocument>) => JSON.stringify([secretsOf(documents), Object.keys(documents).sort()])

function scheduleSecrets(documents: Record<string, RequestDocument>) {
  const signature = secretsSignature(documents)
  if (signature === lastSecrets) return
  lastSecrets = signature

  if (secretsTimer !== undefined) clearTimeout(secretsTimer)
  // Slower than the workspace write: a credential store round trip is far more
  // expensive than a file write, and nothing reads these back until a restart.
  secretsTimer = window.setTimeout(() => {
    secretsTimer = undefined
    void WorkspaceService.SaveSecrets(secretsOf(documents), Object.keys(documents)).then(result => {
      if (result.error) console.warn('[persistence] credential store:', result.error)
      useAppStore.getState().setSecretsAvailable(result.available)
    })
  }, 1200)
}

/**
 * Installs the autosave subscriber. Called only on the success path of `hydrate`,
 * which is what stops a failed or slow load from writing an empty workspace over a
 * real one.
 */
function installAutosave(): void {
  let lastWorkspace = JSON.stringify(toWorkspaceFile(useAppStore.getState()))
  let lastPrefs = JSON.stringify(toPrefsFile(useAppStore.getState()))
  // Seeded from the just-hydrated state, so the first edit to anything else does
  // not look like a credential change and rewrite the keychain for nothing.
  lastSecrets = secretsSignature(useAppStore.getState().documents)

  useAppStore.subscribe((state, prev) => {
    if (state.tree !== prev.tree || state.documents !== prev.documents) {
      const next = JSON.stringify(toWorkspaceFile(state))
      // Serialise and compare rather than trusting reference inequality:
      // `toggleNode` rebuilds `tree` but only changes `expanded`, which is a prefs
      // field, so expanding a folder must not rewrite the file holding your
      // collections. It also makes edit-then-undo a no-op.
      if (next !== lastWorkspace) {
        lastWorkspace = next
        workspaceWriter.schedule(next)
      }
      if (state.documents !== prev.documents) scheduleSecrets(state.documents)
    }

    const nextPrefs = JSON.stringify(toPrefsFile(state))
    if (nextPrefs !== lastPrefs) {
      lastPrefs = nextPrefs
      prefsWriter.schedule(nextPrefs)
    }
  })

  // `run()` calls setSaveState, which re-enters this subscriber. That is safe only
  // because `saveState` is not part of either DTO, so both comparisons come back
  // equal and nothing is scheduled. Adding it to `toPrefsFile` would turn this into
  // an infinite write loop.
}

/** Writes everything pending immediately. Wired to Ctrl+S and to window teardown. */
export function flushNow(): void {
  workspaceWriter.flush()
  prefsWriter.flush()
}

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))])

/**
 * Loads the workspace before the first render.
 *
 * Rendering afterwards is what keeps the first paint from being an empty workspace
 * that then jumps, and it is why the autosave subscriber can never observe a
 * pre-load state: `hydrate` installs it as its last act. The window paints its
 * BackgroundColour (the same colour as the app shell) until this resolves, so the
 * gap is invisible.
 *
 * This never rejects. A browser dev server has no Wails runtime behind the page, so
 * the binding call fails and the session stays in memory rather than refusing to
 * start.
 */
export async function hydrate(): Promise<void> {
  try {
    const [workspace, prefs] = await withTimeout(Promise.all([WorkspaceService.LoadWorkspace(), WorkspaceService.LoadPrefs()]), HYDRATE_TIMEOUT_MS)

    if (workspace.version > WORKSPACE_VERSION) {
      // A file from a newer build. Parsing what we understand and writing the
      // result back would silently truncate the user's data, so do neither: report
      // it and leave autosave uninstalled.
      useAppStore.setState({ persistenceState: 'newer-version', dataDir: await WorkspaceService.DataDir() })
      return
    }

    const collapsed = prefs.found ? readCollapsed(JSON.parse(prefs.payload)) : []
    const loaded = workspace.found ? readWorkspace(JSON.parse(workspace.payload), collapsed) : { tree: [], documents: {} }
    const layout = readPrefs(prefs.found ? JSON.parse(prefs.payload) : {}, loaded.documents, loaded.tree)

    // Credentials come back from the OS store, keyed by request id, so a workspace
    // copied to another machine keeps its requests and simply has no tokens.
    const withAuth = Object.values(loaded.documents).filter(doc => doc.auth.type !== 'none')
    let secretsAvailable = false
    if (withAuth.length) {
      const result = await WorkspaceService.LoadSecrets(withAuth.map(doc => doc.id))
      secretsAvailable = result.available
      for (const secret of result.secrets ?? []) {
        const doc = loaded.documents[secret.id]
        if (doc) loaded.documents[secret.id] = { ...doc, auth: { ...doc.auth, token: secret.token, password: secret.password } }
      }
      if (result.error) console.warn('[persistence] credential store:', result.error)
    } else {
      secretsAvailable = true
    }

    useAppStore.setState({
      tree: loaded.tree,
      documents: loaded.documents,
      tabs: layout.tabs,
      activeId: layout.activeId,
      selectedNodeId: layout.selectedNodeId,
      activeCollectionId: layout.activeCollectionId,
      recentIds: layout.recentIds,
      requestPanel: layout.requestPanel,
      responsePanel: layout.responsePanel,
      sidebarWidth: layout.sidebarWidth,
      sidebarCollapsed: layout.sidebarCollapsed,
      splitOrientation: layout.splitOrientation,
      splitRatio: layout.splitRatio,
      persistenceState: 'ready',
      secretsAvailable,
      quarantinedPath: workspace.quarantined || null,
      dataDir: await WorkspaceService.DataDir(),
    })
  } catch (error) {
    console.warn('[persistence] unavailable, running in memory:', error)
    useAppStore.setState({ persistenceState: 'unavailable' })
    return
  }

  installAutosave()

  // Best effort, not a guarantee: the IPC message is usually delivered before
  // teardown, but nothing promises the reply arrives. The 2s ceiling above is the
  // actual bound on what a hard kill can cost.
  window.addEventListener('beforeunload', flushNow)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow()
  })
}
