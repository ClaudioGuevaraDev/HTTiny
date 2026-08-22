import { Service as WorkspaceService } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/workspace'
import { revealPatch, useAppStore } from './store'
import type { RequestDocument } from './types'
import type { WorkspaceState } from './workspaceFile'
import { PREFS_VERSION, WORKSPACE_VERSION, legacySecretKeys, readCollapsed, readPrefs, readWorkspace, toPrefsFile, toWorkspaceFile } from './workspaceFile'

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
 * The ids handed to the previous save, union'd into the next `keep`.
 *
 * `SaveSecrets` iterates `keep` and deletes the ids in it that were not written; it
 * never enumerates the store, because `go-keyring` has no cross-platform way to. So an
 * id that leaves both lists at once — a deleted request — would otherwise keep its
 * credential forever. Naming it once more is the only way to reach it.
 */
let lastKeep: string[] = []
/**
 * Set when a load came back with an error beside its entries.
 *
 * `LoadSecrets` skips an entry it could not read and reports it, so the in-memory
 * picture is incomplete — and the next save would see that entry in `keep`, absent from
 * the written set, and delete it for looking empty. While this is set the destructive
 * half of the save is switched off for the session.
 */
let secretsReadFailed = false

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
    const live = Object.keys(documents)
    const keep = secretsReadFailed ? [] : [...new Set([...lastKeep, ...live])]
    lastKeep = live
    void WorkspaceService.SaveSecrets(secretsOf(documents), keep).then(result => {
      if (result.error) console.warn('[persistence] credential store:', result.error)
      useAppStore.getState().setSecretsAvailable(result.available)
    })
  }, 1200)
}

/**
 * The store fields that belong in `workspace.json`, as a pre-filter on the subscriber
 * below: serialising the whole file on every store change would run on every keystroke.
 *
 * The check under it is the point of the list. A field added to `WorkspaceState` and
 * forgotten here would be written by `toWorkspaceFile` and never reach disk, with
 * nothing to notice; this makes forgetting a compile error instead.
 */
const WORKSPACE_KEYS = ['tree', 'documents'] as const satisfies readonly (keyof WorkspaceState)[]
const workspaceKeysAreComplete: [Exclude<keyof WorkspaceState, (typeof WORKSPACE_KEYS)[number]>] extends [never] ? true : never = true
void workspaceKeysAreComplete

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
  lastKeep = Object.keys(useAppStore.getState().documents)

  useAppStore.subscribe((state, prev) => {
    if (WORKSPACE_KEYS.some(key => state[key] !== prev[key])) {
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
    const savedWorkspace: unknown = workspace.found ? JSON.parse(workspace.payload) : null
    const loaded = workspace.found ? readWorkspace(savedWorkspace, collapsed) : { tree: [], documents: {} }
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
      if (result.error) {
        // Not just noise: an entry that could not be read loaded empty, and the next
        // save must not delete it for looking that way. See `secretsReadFailed`.
        secretsReadFailed = true
        console.warn('[persistence] credential store:', result.error)
      }
    } else {
      secretsAvailable = true
    }

    // Transitional, and goes with `legacySecretKeys`: the environment variables feature
    // stored one credential per locked variable, nothing names them any more, and a
    // store that cannot be enumerated cannot be swept later. `SaveSecrets` deletes every
    // id in `keep` it was not asked to write — the same pass that clears a deleted
    // request's token — so one round trip finishes it, and only while a workspace file
    // still carries the field. Skipped after a failed read, the rule the debounced save
    // follows for the same reason.
    const orphans = legacySecretKeys(savedWorkspace)
    if (orphans.length && !secretsReadFailed) {
      const swept = await WorkspaceService.SaveSecrets(secretsOf(loaded.documents), [...Object.keys(loaded.documents), ...orphans])
      if (swept.error) console.warn('[persistence] credential store:', swept.error)
    }

    /*
     * Reveal the active request, the way every other writer of `activeId` does.
     *
     * `readPrefs` validates `activeId`, `selectedNodeId` and `activeCollectionId` one at
     * a time, against the tree and the documents — each is a live id, and the three
     * together can still disagree, because `selectCollection` moves the rail without
     * touching the active tab and both fields are persisted. Hydration was the one
     * writer of `activeId` that did not apply `revealPatch`, so a launch could show the
     * rail on one collection while the active tab belonged to another, with no row
     * selected.
     */
    const revealed = revealPatch(loaded.tree, layout.activeId, layout.selectedNodeId, layout.activeCollectionId)

    useAppStore.setState({
      documents: loaded.documents,
      // Spread, not seventeen enumerated fields — and that is a correctness measure, not
      // brevity. `setState` takes a `Partial`, so a preference left out of the list was
      // saved correctly and loaded into nothing, with no type error anywhere: the comment
      // this replaces warned about exactly that for `language`, and the code view's two
      // preferences were then added and silently forgotten, resetting it on every
      // launch. `PrefsState` is defined as "everything readPrefs returns is store
      // state", so a new preference now arrives by existing.
      ...layout,
      // After `layout`, so the reveal wins over the three fields it recomputes — and it
      // carries `tree` too, which is why that is not spread above.
      ...revealed,
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
