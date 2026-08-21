import { Service as WorkspaceService } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/workspace'
import { environmentSecretKey } from './environments'
import { revealPatch, useAppStore } from './store'
import type { Environment, RequestDocument } from './types'
import type { WorkspaceState } from './workspaceFile'
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

/**
 * The same, for environment variables the user locked.
 *
 * One entry per variable rather than one blob per environment: `secrets.Set` rejects a
 * marshalled entry over 2560 bytes, and a blob would be doubly encoded, so a single
 * oversized value would fail the write for every secret in that environment at once —
 * reported only in `SecretsResult.error`. Per variable, the cap is spent on one
 * credential and a failure is isolated.
 *
 * The value goes in `token` and `password` stays empty. `Entry.Empty()` is both fields
 * blank, so clearing a value deletes the entry without Go needing to know what this is.
 *
 * A `Map`, so two rows typed with the same key write one entry instead of racing. Last
 * wins, which is the rule `resolverFor` applies to the same collision.
 */
const environmentSecretsOf = (environments: readonly Environment[]) => {
  const entries = new Map<string, { id: string; token: string; password: string }>()
  for (const env of environments) {
    for (const variable of env.variables) {
      const key = variable.key.trim()
      if (!variable.secret || !key || !variable.value) continue
      const id = environmentSecretKey(env.id, key)
      entries.set(id, { id, token: variable.value, password: '' })
    }
  }
  return [...entries.values()]
}

/**
 * Every id the credential store should be reconciled against.
 *
 * Every variable that has a key, **not only the locked ones** — the same way the
 * documents half is `Object.keys(documents)` and not "documents with auth". An entry is
 * deleted by appearing here and not in the entries list, so a variable whose lock was
 * just taken off is cleared from the OS store precisely because it is still named here.
 */
const secretKeysOf = (documents: Record<string, RequestDocument>, environments: readonly Environment[]) => [
  ...Object.keys(documents),
  ...environments.flatMap(env => env.variables.filter(v => v.key.trim()).map(v => environmentSecretKey(env.id, v.key.trim()))),
]

let secretsTimer: number | undefined
let lastSecrets = ''
/**
 * The ids handed to the previous save, union'd into the next `keep`.
 *
 * `SaveSecrets` iterates `keep` and deletes the ids in it that were not written; it
 * never enumerates the store, because `go-keyring` has no cross-platform way to. So an
 * id that leaves both lists at once — a deleted request, a renamed or removed variable —
 * would otherwise keep its credential forever. Naming it once more is the only way to
 * reach it.
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
const secretsSignature = (documents: Record<string, RequestDocument>, environments: readonly Environment[]) =>
  JSON.stringify([secretsOf(documents), environmentSecretsOf(environments), secretKeysOf(documents, environments).sort()])

function scheduleSecrets(documents: Record<string, RequestDocument>, environments: readonly Environment[]) {
  const signature = secretsSignature(documents, environments)
  if (signature === lastSecrets) return
  lastSecrets = signature

  if (secretsTimer !== undefined) clearTimeout(secretsTimer)
  // Slower than the workspace write: a credential store round trip is far more
  // expensive than a file write, and nothing reads these back until a restart.
  secretsTimer = window.setTimeout(() => {
    secretsTimer = undefined
    const live = secretKeysOf(documents, environments)
    const keep = secretsReadFailed ? [] : [...new Set([...lastKeep, ...live])]
    lastKeep = live
    void WorkspaceService.SaveSecrets([...secretsOf(documents), ...environmentSecretsOf(environments)], keep).then(result => {
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
/**
 * The store fields that can make `workspace.json` dirty. A pre-filter and not the
 * decision — the serialise-and-compare below is what actually decides — but it is what
 * keeps the whole workspace from being stringified on every unrelated `set`, including
 * the `setSaveState` calls that re-enter this subscriber three times per write.
 *
 * The check under it is the point of the list. A field added to `WorkspaceState` and
 * forgotten here would be written by `toWorkspaceFile` and never reach disk, with
 * nothing to notice; this makes forgetting a compile error instead.
 */
const WORKSPACE_KEYS = ['tree', 'documents', 'environments'] as const satisfies readonly (keyof WorkspaceState)[]
const workspaceKeysAreComplete: [Exclude<keyof WorkspaceState, (typeof WORKSPACE_KEYS)[number]>] extends [never] ? true : never = true
void workspaceKeysAreComplete

function installAutosave(): void {
  let lastWorkspace = JSON.stringify(toWorkspaceFile(useAppStore.getState()))
  let lastPrefs = JSON.stringify(toPrefsFile(useAppStore.getState()))
  // Seeded from the just-hydrated state, so the first edit to anything else does
  // not look like a credential change and rewrite the keychain for nothing.
  lastSecrets = secretsSignature(useAppStore.getState().documents, useAppStore.getState().environments)
  lastKeep = secretKeysOf(useAppStore.getState().documents, useAppStore.getState().environments)

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
      if (state.documents !== prev.documents || state.environments !== prev.environments) scheduleSecrets(state.documents, state.environments)
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
    const loaded = workspace.found ? readWorkspace(JSON.parse(workspace.payload), collapsed) : { tree: [], documents: {}, environments: [] }
    const layout = readPrefs(prefs.found ? JSON.parse(prefs.payload) : {}, loaded)

    /*
     * Reveal the active request, the way every other writer of `activeId` does.
     *
     * This was the one that did not, and it is why startup could show the rail on one
     * collection while the active tab belonged to another, with no row selected in the
     * tree. `selectCollection` moves the rail and clears the selection *without* touching
     * `activeId`, and all three fields are persisted, so `ui.json` faithfully records a
     * pair that disagrees — and `readPrefs` validates each field on its own, so it keeps
     * both rather than reconciling them. Revealing here makes starting up mean the same
     * thing as activating that tab.
     *
     * Before `installAutosave`, so the expanded tree is the baseline rather than an edit,
     * and `workspace.json` is not rewritten just for having been opened.
     *
     * It returns its inputs unchanged when the request is not in the tree, so "no tab
     * open" and "the tab's node was deleted" both need no branch here.
     */
    const revealed = revealPatch(loaded.tree, layout.activeId, layout.selectedNodeId, layout.activeCollectionId)

    // Credentials come back from the OS store, keyed by request id, so a workspace
    // copied to another machine keeps its requests and simply has no tokens. Locked
    // environment variables ride along in the same call — it is one round trip on the
    // startup path, which is why `LoadSecrets` takes a list at all.
    const withAuth = Object.values(loaded.documents).filter(doc => doc.auth.type !== 'none')

    // Built from our own key function rather than by parsing an id back apart, so a
    // document whose id was hand-edited to start with `env:` cannot claim a variable's
    // value.
    const variableKeys = new Set<string>()
    for (const env of loaded.environments) {
      for (const variable of env.variables) {
        const key = variable.key.trim()
        if (variable.secret && key) variableKeys.add(environmentSecretKey(env.id, key))
      }
    }

    let secretsAvailable = true
    if (withAuth.length || variableKeys.size) {
      const result = await WorkspaceService.LoadSecrets([...withAuth.map(doc => doc.id), ...variableKeys])
      secretsAvailable = result.available
      const values = new Map<string, string>()
      for (const secret of result.secrets ?? []) {
        // Environments first: those ids are ours and a document cannot shadow one.
        if (variableKeys.has(secret.id)) {
          values.set(secret.id, secret.token)
          continue
        }
        const doc = loaded.documents[secret.id]
        if (doc) loaded.documents[secret.id] = { ...doc, auth: { ...doc.auth, token: secret.token, password: secret.password } }
      }
      if (values.size) {
        loaded.environments = loaded.environments.map(env => ({
          ...env,
          variables: env.variables.map(variable => {
            const stored = variable.secret ? values.get(environmentSecretKey(env.id, variable.key.trim())) : undefined
            return stored === undefined ? variable : { ...variable, value: stored }
          }),
        }))
      }
      if (result.error) {
        // Not just noise: an entry that could not be read loaded empty, and the next
        // save must not delete it for looking that way. See `secretsReadFailed`.
        secretsReadFailed = true
        console.warn('[persistence] credential store:', result.error)
      }
    }

    // When no credential store is reachable at all, Go's `SaveSecrets` and
    // `LoadSecrets` both return before touching anything — so the blank values loaded
    // here are never written over real ones, and the `keep` sweep never runs. That is
    // load-bearing, not incidental: do not "fix" either early return.
    useAppStore.setState({
      documents: loaded.documents,
      environments: loaded.environments,
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
