import { useSyncExternalStore } from 'react'
import { collectionInPlay, collectionOf, useAppStore } from './store'
import type { ResolutionState } from './store'
import { IDENTITY, resolverFor, variableMap } from './template'
import type { Resolve } from './template'
import type { Environment } from './types'

/**
 * The bridge between the store and `template.ts`, the way `language.ts` bridges the
 * store and `i18n/`. `template.ts` stays a pure leaf and this is the one module that
 * knows which environment applies where.
 *
 * The tree-side question — which collection a request belongs to — is answered in
 * `store.ts`, because a store action has to ask it too and this module already imports
 * the store, so the answer cannot live here without closing a cycle. Everything here
 * turns that answer into a resolver.
 */

/**
 * The credential-store key for one environment variable.
 *
 * Keyed by the variable's **key**, never by its row id: stored variables carry no id
 * and `readVariables` regenerates one from the position, so an id changes the moment a
 * row is inserted above — and a keychain entry that moved would be a credential
 * silently attached to a different variable. Keyed by the environment rather than by a
 * collection for the same reason the pool is shared: the value belongs to the
 * environment, whichever collections happen to point at it.
 *
 * Injective without any escaping, because an environment id is minted as `env-<stamp>`
 * and holds no colon; everything after the second one is the user's key, whatever is in
 * it. Nothing ever parses this back apart — the save path and the load path both build
 * it from the same two inputs.
 */
export const environmentSecretKey = (envId: string, key: string): string => `env:${envId}:${key}`

// ── Which environment applies ──────────────────────────────────────────────────

/** A collection's pick, validated against the pool. */
const idIn = (state: ResolutionState, collection: string | null): string | null => {
  const id = collection ? state.environmentByCollection[collection] : undefined
  // Validated rather than trusted. `deleteEnvironment` and `readPrefs` both prune, so
  // this is the third guard — but it is the one the picker depends on: a `Select` whose
  // `value` matches no option renders blank, and a stale entry has to read as "none".
  return id && state.environments.some(env => env.id === id) ? id : null
}

/**
 * The environment a **specific** request resolves against, and the send path's only
 * question.
 *
 * No fallback when the request belongs to no collection — the opposite of
 * `collectionInPlay`, and deliberately so. This is the one asymmetry in the design: the
 * interface question falls back to the rail, the send question does not. An unresolved
 * `{{baseUrl}}` is a request that plainly fails; borrowing whatever the rail happens to
 * be showing would point a send at another server's credentials, which is the reason
 * `deleteEnvironment` falls to none rather than to the next survivor.
 */
export const environmentIdFor = (state: ResolutionState, requestId: string | undefined): string | null =>
  requestId ? idIn(state, collectionOf(state, requestId)) : null

export const environmentFor = (state: ResolutionState, requestId: string | undefined): Environment | undefined => {
  const id = environmentIdFor(state, requestId)
  return id ? state.environments.find(env => env.id === id) : undefined
}

/**
 * The environment the *interface* is pointed at — the active request's collection, else
 * the rail's. What the picker shows, what the palette switches, and what the editors
 * paint their chips against.
 */
export const applicableEnvironmentId = (state: ResolutionState): string | null => idIn(state, collectionInPlay(state))

/**
 * The resolver for one request.
 *
 * Reads `useAppStore.getState()` at call time rather than closing over a snapshot, the
 * rule `runRequest` states and `Command.run` states again. It takes the request id
 * because resolution is per collection: a single "active" resolver would answer for
 * whichever tab happens to be in front, and both callers already hold the document.
 */
export const resolveFor = (requestId: string): Resolve => {
  const environment = environmentFor(useAppStore.getState(), requestId)
  return environment ? resolverFor(variableMap(environment.variables)) : IDENTITY
}

/**
 * The same, for the mask list.
 *
 * Keyed by the same id as `resolveFor`, and that agreement is structural rather than
 * incidental: the masks have to come from the environment that *substituted* the values,
 * or a snippet resolved against staging would be masked with production's strings and
 * print a live token.
 */
export const secretsFor = (requestId: string): Map<string, string> => secretsIn(environmentFor(useAppStore.getState(), requestId))

/**
 * The environment applying to the active request, which is what every mounted editor is
 * showing. "Active" has always meant the active request in this codebase, and with a
 * per-collection selection that is now literally what it resolves through.
 */
export const activeEnvironment = (): Environment | undefined => {
  const state = useAppStore.getState()
  const id = applicableEnvironmentId(state)
  return state.environments.find(env => env.id === id)
}

/** The names it defines. What a chip is classified against. */
export const activeVariables = (): ReadonlyMap<string, string> => variableMap(activeEnvironment()?.variables ?? [])

/**
 * Fires when the *resolution* changes — a different environment picked for the collection
 * in play, the active tab moved to a request in another collection, a row retyped, a
 * checkbox unticked — and never for anything else in the store.
 *
 * Three clauses, in this order, and the order is the design.
 *
 * The **pool** first and unconditionally: any edit to `environments` can change what a
 * `{{name}}` resolves to whichever environment is picked, and comparing the derived id
 * alone would miss every one of them — the id does not move when a row is retyped.
 *
 * The **identity** clause second, and it is the load-bearing one. Without it `setBody` —
 * which fires on every keystroke in the body — would reach the listener, and the listener
 * dispatches into the very view that is mid-update. Every field the resolution reads is
 * named here, which is what `ResolutionState` is for: this list and that type disagreeing
 * is the bug to watch for.
 *
 * The **derived** clause last, because two of those identities move without moving the
 * answer: `toggleNode` gives every node in `tree` a new identity on each folder expand,
 * and `selectCollection` moves the rail out from under a request that keeps its own
 * environment. `previous` is asked before `state` so the tree cache behind `collectionOf`
 * is left warm on the current tree, which is what every later listener in the same
 * notification pass — and `readVariables` on the render after it — is about to ask for.
 */
export const subscribeEnvironment = (onChange: () => void): (() => void) =>
  useAppStore.subscribe((state, previous) => {
    if (state.environments !== previous.environments) {
      onChange()
      return
    }
    if (
      state.environmentByCollection === previous.environmentByCollection &&
      state.tree === previous.tree &&
      state.activeId === previous.activeId &&
      state.activeCollectionId === previous.activeCollectionId
    )
      return
    if (applicableEnvironmentId(previous) === applicableEnvironmentId(state)) return
    onChange()
  })

/**
 * The known-name map as a React value, for the static half of `TemplateInput`.
 *
 * `useSyncExternalStore` over the same subscription the editor plugin uses, rather than
 * store selectors and a `useMemo`: the map is derived, so a selector would hand back a
 * fresh object on every render and defeat the memo it was feeding. This one has to return
 * the *same* reference while nothing has changed, or every field re-renders on every
 * store update.
 *
 * Recomputed on read and cached against the two things it derives from, rather than
 * recomputed in the subscription callback. That ordering matters: hydration replaces the
 * store before `createRoot` runs, so a snapshot computed at module load would already be
 * stale by the first render — and the subscription is not installed until that render, so
 * nothing would ever correct it.
 *
 * The key is the pool plus the **derived** id, not the five identities the guard tests.
 * That is what keeps a folder expand from handing every mounted field a fresh map.
 */
let cachedKey: { environments: readonly Environment[]; id: string | null } | null = null
let cached: ReadonlyMap<string, string> = new Map()

const readVariables = (): ReadonlyMap<string, string> => {
  const state = useAppStore.getState()
  const id = applicableEnvironmentId(state)
  if (!cachedKey || cachedKey.environments !== state.environments || cachedKey.id !== id) {
    cachedKey = { environments: state.environments, id }
    cached = activeVariables()
  }
  return cached
}

export const useVariables = (): ReadonlyMap<string, string> => useSyncExternalStore(subscribeEnvironment, readVariables)

/**
 * An environment's secret values, keyed by variable name.
 *
 * What `redactWire` masks with. Only locked variables that actually have a value: an
 * empty one would match everywhere and blank the whole snippet.
 *
 * Pure and taking the environment, so a component can memoise it on the environment it
 * selected rather than on a call that reads the store behind the linter's back.
 */
export const secretsIn = (environment: Environment | undefined): Map<string, string> => {
  const out = new Map<string, string>()
  for (const variable of environment?.variables ?? []) {
    const key = variable.key.trim()
    if (variable.enabled && variable.secret && key && variable.value) out.set(key, variable.value)
  }
  return out
}
