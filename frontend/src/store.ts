import { create } from 'zustand'
import { translate } from './i18n'
import { DEFAULT_BODY_VIEW } from './responseBody'
import { DEFAULT_SNIPPET_TARGET, type SnippetTarget } from './snippets'
import type {
  BodyLanguage,
  BodyView,
  CollectionNode,
  Environment,
  EnvironmentVariable,
  HttpMethod,
  KeyValueRow,
  Locale,
  RequestDocument,
  RequestPanel,
  ResponsePanel,
  ResponseSearch,
  ResponseSnapshot,
  SplitOrientation,
  ThemePreference,
  TreeNode,
  UpdateState,
} from './types'

/** Closed, with nothing typed and both toggles off — the state Ctrl+F opens into. */
const DEFAULT_RESPONSE_SEARCH: ResponseSearch = { open: false, query: '', caseSensitive: false, regexp: false }

/**
 * Layout bounds, defined here because the store is what clamps them. They used to
 * live in `workspaceFile.ts` while `App.tsx` and the setters below each repeated the
 * literals — three copies of the same four numbers.
 *
 * `sidebarWidth` covers the rail *and* the panel, so the minimum is the old tree
 * minimum plus the rail. A width persisted before the rail existed still lands
 * inside the new range, so no migration is needed.
 */
export const SIDEBAR_WIDTH = { min: 268, max: 468, default: 330 } as const
export const SPLIT_RATIO = { min: 30, max: 72, default: 52 } as const

/**
 * A percentage, and an integer one: it is written to `ui.json` on every change, and a
 * ratio would accumulate the usual binary dust there for nothing.
 */
export const ZOOM = { min: 80, max: 150, default: 100 } as const
/** The stops the stepper and the shortcuts move between. `ZOOM.min`/`max` are its ends. */
export const ZOOM_STEPS = [80, 90, 100, 110, 125, 150] as const

/**
 * Pixels, and no list of stops: every integer is a legitimate type size. Governs
 * `--text-code`, which feeds nothing but the two editors — so this is the knob the zoom
 * cannot be, the one that leaves the chrome alone.
 */
export const CODE_FONT_SIZE = { min: 10, max: 22, default: 13 } as const

/**
 * What a fresh install gets, and what "Restore defaults" restores. One object so those two
 * cannot drift apart: the initial state spreads it and the action assigns it, instead of a
 * reset written out by hand becoming a third copy and the first to fall behind.
 *
 * `satisfies` ties every field to the type the store declares, so renaming one breaks here
 * rather than silently resetting nothing.
 *
 * `sidebarCollapsed` is deliberately absent: it is not a settings-modal preference but a
 * workspace state, toggled from `Ctrl+B` and its own button, and restoring settings has no
 * business unfolding a sidebar somebody hid.
 */
export const SETTINGS_DEFAULTS = {
  theme: 'system',
  language: 'en',
  zoom: ZOOM.default,
  codeFontSize: CODE_FONT_SIZE.default,
  defaultBodyLanguage: null,
  defaultRedactSecrets: false,
  splitOrientation: 'rows',
  sidebarWidth: SIDEBAR_WIDTH.default,
  splitRatio: SPLIT_RATIO.default,
} as const satisfies Pick<
  AppState,
  | 'theme'
  | 'language'
  | 'zoom'
  | 'codeFontSize'
  | 'defaultBodyLanguage'
  | 'defaultRedactSecrets'
  | 'splitOrientation'
  | 'sidebarWidth'
  | 'splitRatio'
>

/**
 * The next stop in a direction. `findIndex` rather than `indexOf` so a value that is not
 * a stop at all — a hand-edited `ui.json` — still moves instead of sticking: the first
 * stop past it in that direction wins.
 */
const stepZoom = (zoom: number, direction: 1 | -1): number => {
  const next = direction === 1 ? ZOOM_STEPS.find(stop => stop > zoom) : [...ZOOM_STEPS].reverse().find(stop => stop < zoom)
  return next ?? (direction === 1 ? ZOOM.max : ZOOM.min)
}

/**
 * What a request opens on when it has never chosen a panel of its own. Exported because
 * three places need the same answer: the two components that read the maps below, and
 * `workspaceFile.ts`, which leaves a request at its default out of the prefs file.
 */
export const DEFAULT_REQUEST_PANEL: RequestPanel = 'params'
export const DEFAULT_RESPONSE_PANEL: ResponsePanel = 'body'

interface AppState {
  tree: TreeNode[]
  documents: Record<string, RequestDocument>
  /**
   * The environments. Workspace data, alongside `tree` and `documents` and written to
   * the same file — which is why the autosave subscriber's reference guard names all
   * three, and why `WorkspaceState` in `workspaceFile.ts` exists to make forgetting
   * one a compile error.
   */
  environments: Environment[]
  /**
   * Which environment each collection's `{{variables}}` resolve against, keyed by
   * collection id. An **absent** key is "no environment" — the same "absent until
   * something is chosen" the three panel maps use, so "chose none" needs no null of its
   * own and leaves nothing behind to prune.
   *
   * A preference, not workspace data: it goes to `ui.json` beside `activeCollectionId`,
   * which is the same class of choice — which of your things you are pointed at. A
   * workspace copied to another machine should not drag "Production" along with it.
   *
   * Keyed by collection because the tab strip is not: `RequestTabs` iterates `tabs`
   * unfiltered, so one strip can hold requests from four collections, and one
   * workspace-wide pick meant Ctrl+Enter on a staging request could reach production.
   * What is shared is the *pool* — `environments` above; what is per collection is only
   * which of them is picked.
   *
   * A `Record` and not a `Map`, and that is not a style choice: `toPrefsFile`'s output is
   * compared as JSON to decide whether `ui.json` is dirty, and a `Map` serialises to
   * `{}` — every write would compare equal and nothing would ever reach disk.
   */
  environmentByCollection: Record<string, string>
  tabs: string[]
  activeId: string | null
  selectedNodeId: string | null
  /**
   * Which collection the sidebar is showing. The tree renders this collection's
   * children only, so this is what the rail switches — and what has to follow along
   * when a request is revealed from the command palette.
   */
  activeCollectionId: string | null
  /**
   * Which section each half of the workspace is showing, keyed by request id and in the
   * same class of state as `bodyViews` below: per request, absent until something is
   * chosen, meaningless once the request is gone.
   *
   * Both were single fields once, and that made the panel a property of the window:
   * leaving one request on Headers opened every *other* request on Headers too, including
   * ones that had never been looked at. Which section you are editing belongs to the
   * request, the way its URL does.
   *
   * Per request, but **not** across launches — these three never reach `ui.json`. Closing
   * the app on Timeline and finding it there again is restoring a view of a response that
   * no longer exists, since `responses` below is never persisted either. See the note in
   * `workspaceFile.ts`.
   */
  requestPanels: Record<string, RequestPanel>
  responsePanels: Record<string, ResponsePanel>
  responses: Record<string, ResponseSnapshot>
  /**
   * How each request's response body is being shown. Keyed by request id and pruned
   * alongside `documents` and `responses`, because it is the same class of state:
   * per request, and meaningless once the request is gone. Absent means
   * `DEFAULT_BODY_VIEW` — nothing is written until something is chosen.
   */
  bodyViews: Record<string, BodyView>

  /** Most-recently-activated request ids, newest first, capped at 12. */
  recentIds: string[]

  // Persistence status, owned by persistence.ts and rendered in the sidebar footer.
  // `unavailable` is the browser dev server, which has no Wails runtime behind it;
  // `newer-version` is a workspace file written by a later build, which is read-only
  // by design rather than being silently truncated.
  persistenceState: 'loading' | 'ready' | 'unavailable' | 'newer-version'
  saveState: 'idle' | 'pending' | 'saving' | 'saved' | 'error'
  /** False when no OS credential store could be reached — tokens are session-only. */
  secretsAvailable: boolean
  /** Set when an unreadable workspace file was moved aside on load. */
  quarantinedPath: string | null
  dataDir: string

  // Layout preferences live here rather than in App's local state because two
  // independent surfaces mutate them — the workspace buttons and palette commands —
  // and AGENTS.md keeps shared state out of presentation components.
  sidebarWidth: number
  sidebarCollapsed: boolean
  splitOrientation: SplitOrientation
  splitRatio: number

  /** Applied by `zoom.ts` as a CSS `zoom` on the root, in percent. */
  zoom: number
  /** Applied by `codeFont.ts` as `--text-code`, in pixels. */
  codeFontSize: number
  /** Applied by `theme.ts`, which resolves `system` before CSS ever sees it. */
  theme: ThemePreference
  /** Applied by `language.ts`, which pushes it into the message runtime and onto `<html lang>`. */
  language: Locale
  /**
   * What the response viewer opens a body as when the request has no pick of its own.
   * `null` is "automatic", which defers to the body and then to Go's classification —
   * see `resolveLanguage`, which owns the precedence.
   */
  defaultBodyLanguage: BodyLanguage | null
  /**
   * What the code view opens its redaction switch on. A *default*, like the field above:
   * the switch in the modal still overrides it, for that visit only.
   *
   * The switch itself was persisted once, which meant one click quietly changed what every
   * later session showed — a control that rewrites a credential must not be able to stay on
   * behind your back. Saying so in Settings is a different act: it is deliberate, it is
   * visible, and it is somewhere you can find it again.
   */
  defaultRedactSecrets: boolean

  // Only open/closed lives here; the palette's query and highlighted index stay
  // local to the dialog, since they change on every keystroke and nothing outside
  // it reads them.
  paletteOpen: boolean
  paletteSeed: string
  /** Not persisted: an open modal is not a preference worth restoring. */
  settingsOpen: boolean
  /** The environments editor. Same rule as the line above. */
  environmentsOpen: boolean

  /**
   * The code view, and only what something outside the modal reads: whether it is open,
   * and which language it is showing. Its redaction switch is not here — it is a
   * `useState` in `CodeBody`, seeded from `defaultRedactSecrets` above, which is the rule
   * the palette's query already follows: state nothing outside the dialog reads belongs
   * to the dialog. The body only mounts while the dialog is open, so every opening
   * re-seeds itself and no one has to remember to reset it on the way out.
   *
   * The generated snippet is in neither place. It is derived from the request and from
   * `Wire`'s answer, both of which can change on any keystroke, so holding it would mean
   * keeping a copy in sync for no reader — and it is the one string in the app that can
   * contain a credential in plain text.
   *
   * `codeTarget` lasts the session and is not written to `ui.json`, for the reason its
   * neighbour above is: it is where you left the picker, not a preference you went and
   * set. Same rule as the panel maps.
   */
  codeOpen: boolean
  codeTarget: SnippetTarget

  /**
   * The response viewer's search bar. Unlike the palette's query, this one lives in the
   * store rather than in the component: three places open it — the global Ctrl+F, the
   * command palette and the viewer's own close button — and two of them have no way to
   * reach a `useState` inside `ResponseViewer`.
   *
   * Not persisted either. `toPrefsFile` is an explicit whitelist, so leaving it out of
   * that function is all it takes; a search bar that reopens on launch would be noise.
   */
  responseSearch: ResponseSearch

  /**
   * The update flow. Transient like `responseSearch` and for the same reason: two
   * places drive it — the startup check and the modal's own buttons — and neither
   * can reach a `useState` inside a component that is not mounted yet.
   */
  update: UpdateState

  /**
   * Whether the update modal has been closed. Kept apart from `update` on purpose:
   * that field says *what* update exists and this one says whether its modal is on
   * screen, so postponing hides the dialog without losing the finding — which is what
   * lets the sidebar footer keep offering it.
   *
   * Not persisted. The check runs again on the next launch and will re-open the modal
   * by itself, so remembering this across restarts would only suppress it.
   */
  updateDismissed: boolean

  openRequest: (id: string) => void
  closeRequest: (id: string) => void
  setActive: (id: string) => void
  selectCollection: (id: string) => void
  setSaveState: (state: AppState['saveState']) => void
  setSecretsAvailable: (available: boolean) => void
  updateDocument: (id: string, patch: Partial<RequestDocument>) => void
  setRows: (id: string, key: 'params' | 'headers', rows: KeyValueRow[]) => void
  setBody: (id: string, patch: Partial<RequestDocument['body']>) => void
  /** The id is minted by the caller, which then has it to select the new environment with. */
  addEnvironment: (id: string, name?: string) => void
  renameEnvironment: (id: string, name: string) => void
  duplicateEnvironment: (id: string, nextId: string) => void
  deleteEnvironment: (id: string) => void
  /** Wholesale, like `setRows`: the grid owns row identity and hands back the array. */
  setEnvironmentVariables: (id: string, variables: EnvironmentVariable[]) => void
  setActiveEnvironment: (id: string | null) => void
  toggleNode: (nodeId: string) => void
  addNode: (type: 'collection' | 'folder' | 'request', parentId?: string, name?: string) => void
  renameNode: (nodeId: string, name: string) => void
  deleteNode: (nodeId: string) => void
  revealNode: (requestId: string) => void
  setRequestPanel: (id: string, panel: RequestPanel) => void
  setResponsePanel: (id: string, panel: ResponsePanel) => void
  setResponse: (id: string, response: ResponseSnapshot) => void
  setBodyView: (id: string, patch: Partial<BodyView>) => void
  setSidebarWidth: (width: number) => void
  toggleSidebar: () => void
  setSplitOrientation: (orientation: SplitOrientation) => void
  toggleSplitOrientation: () => void
  setSplitRatio: (ratio: number) => void
  setZoom: (zoom: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  setCodeFontSize: (size: number) => void
  setTheme: (theme: ThemePreference) => void
  setLanguage: (language: Locale) => void
  resetSettings: () => void
  setDefaultBodyLanguage: (language: BodyLanguage | null) => void
  setDefaultRedactSecrets: (redact: boolean) => void
  openPalette: (seed?: string) => void
  closePalette: () => void
  /** A patch, like `setBodyView`: callers change one field and leave the rest alone. */
  setResponseSearch: (patch: Partial<ResponseSearch>) => void
  setUpdate: (update: UpdateState) => void
  dismissUpdate: () => void
  reopenUpdate: () => void
  openSettings: () => void
  closeSettings: () => void
  openEnvironments: () => void
  closeEnvironments: () => void
  openCode: () => void
  closeCode: () => void
  setCodeTarget: (target: SnippetTarget) => void
}

const mapTree = (nodes: TreeNode[], fn: (node: TreeNode) => TreeNode): TreeNode[] =>
  nodes.map(n => {
    const node = fn(n)
    return node.type !== 'request' ? { ...node, children: mapTree(node.children, fn) } : node
  })

const removeNode = (nodes: TreeNode[], id: string): TreeNode[] =>
  nodes.filter(n => n.id !== id).map(n => (n.type === 'request' ? n : { ...n, children: removeNode(n.children, id) }))

const insertNode = (nodes: TreeNode[], parentId: string | undefined, child: TreeNode): TreeNode[] => {
  if (!parentId) return [...nodes, child]
  return nodes.map(n =>
    n.id === parentId && n.type !== 'request'
      ? { ...n, expanded: true, children: [...n.children, child] }
      : n.type === 'request'
        ? n
        : { ...n, children: insertNode(n.children, parentId, child) },
  )
}

/** The tree node pointing at a given document, or null if it has been deleted. */
const findRequestNodeId = (nodes: TreeNode[], requestId: string): string | null => {
  for (const node of nodes) {
    if (node.type === 'request') {
      if (node.requestId === requestId) return node.id
      continue
    }
    const found = findRequestNodeId(node.children, requestId)
    if (found) return found
  }
  return null
}

export const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.type !== 'request') {
      const found = findNode(node.children, id)
      if (found) return found
    }
  }
  return null
}

/** Every document id in a subtree, so deleting a folder prunes its requests too. */
export const requestIdsIn = (node: TreeNode): string[] => (node.type === 'request' ? [node.requestId] : node.children.flatMap(requestIdsIn))

export interface VisibleRow {
  node: TreeNode
  depth: number
  parentId: string | null
  /** 1-based position among siblings, and the sibling count — `aria-posinset`/`aria-setsize`. */
  position: number
  siblings: number
}

/**
 * The tree flattened to exactly the rows a user can see, in visual order. This is what
 * makes keyboard navigation possible: `↑`/`↓` are a step through this array, and `←`/`→`
 * need the parent id, which the nested structure does not carry.
 *
 * Collapsed branches contribute their own row and nothing beneath it, which is the whole
 * point — arrow keys must not walk into rows that are not on screen. The flat shape is
 * also what the sidebar renders: an ARIA tree may be authored flat as long as every row
 * declares its level and position, and that avoids a wrapper element per branch.
 */
export const flattenVisible = (nodes: TreeNode[], depth = 0, parentId: string | null = null): VisibleRow[] =>
  nodes.flatMap((node, index) => {
    const row: VisibleRow = { node, depth, parentId, position: index + 1, siblings: nodes.length }
    return node.type !== 'request' && node.expanded ? [row, ...flattenVisible(node.children, depth + 1, node.id)] : [row]
  })

/** Ids of every ancestor of `id`, outermost first — used to expand a revealed row. */
const ancestorIds = (nodes: TreeNode[], id: string, trail: string[] = []): string[] | null => {
  for (const node of nodes) {
    if (node.id === id) return trail
    if (node.type !== 'request') {
      const found = ancestorIds(node.children, id, [...trail, node.id])
      if (found) return found
    }
  }
  return null
}

/**
 * The collection an ancestor trail belongs to.
 *
 * Collections are always root nodes — `addNode` inserts one with no parent whatever is
 * selected, `collectionsIn` lists only the top level, and `adopt` in `workspaceFile.ts`
 * moves a stray root folder *into* one. So the outermost ancestor is the collection and
 * every ancestor after it is a folder.
 *
 * Here rather than spelled `ancestors[0]` at the two call sites, because it is the
 * invariant a third reader would get wrong.
 */
const collectionIn = (ancestors: readonly string[]): string | null => ancestors[0] ?? null

const remember = (recentIds: string[], id: string): string[] => [id, ...recentIds.filter(recent => recent !== id)].slice(0, 12)

/**
 * What it takes to make a request visible in the sidebar: switch to its collection,
 * expand every ancestor, select its row.
 *
 * The tree only renders one collection's children, so activating a tab without this
 * left the selection on a row that was not on screen — and `containerFor` would then
 * place a new request beside it, inside a collection you were not looking at.
 *
 * Takes `tree` rather than the whole state because `deleteNode` applies it to the
 * tree it has just pruned, not to the one still in the store. Returns its inputs
 * unchanged when the request is not in the tree — the same fallback `setActive`
 * spelled out as `?? s.selectedNodeId`.
 *
 * This is the invariant tying `activeId`, `activeCollectionId` and `selectedNodeId`
 * together, so **every** writer of `activeId` applies it — hydration included, which
 * used to be the one exception. `selectCollection` and `addNode('collection')` move the
 * rail and clear the selection *without* touching `activeId`, and all three fields are
 * persisted, so `ui.json` can legitimately hold a pair that disagrees; `readPrefs`
 * validates each field on its own and cannot repair it. Exported for that one caller.
 */
export const revealPatch = (tree: TreeNode[], requestId: string | null, selectedNodeId: string | null, activeCollectionId: string | null) => {
  const nodeId = requestId ? findRequestNodeId(tree, requestId) : null
  if (!nodeId) return { tree, selectedNodeId, activeCollectionId }
  const ancestors = ancestorIds(tree, nodeId) ?? []
  // Only rebuild the tree when something is actually collapsed. `mapTree` gives every
  // node a new identity, and the autosave subscriber serialises the whole workspace
  // the moment `tree` changes reference (persistence.ts:116) — too much for a click
  // on a tab that reveals nothing.
  const collapsed = ancestors.some(id => {
    const node = findNode(tree, id)
    return node !== null && node.type !== 'request' && !node.expanded
  })
  return {
    tree: collapsed ? mapTree(tree, n => (n.type !== 'request' && ancestors.includes(n.id) ? { ...n, expanded: true } : n)) : tree,
    selectedNodeId: nodeId,
    activeCollectionId: collectionIn(ancestors) ?? activeCollectionId,
  }
}

/**
 * Where a new node goes when the caller does not name a parent: into the selected
 * container, or alongside the selected request, else at the root.
 *
 * Three call sites used to hardcode `'main'` — the id of a collection that existed
 * only in the deleted fixtures. `insertNode` returns the tree unchanged when no
 * node matches, so with an empty tree the sidebar's New folder and New request
 * buttons silently did nothing, and `addNode('request', 'main')` was worse than a
 * no-op: it still created the document and opened a tab, leaving a request that
 * belonged to no tree and could never be found again once the tab was closed.
 */
const containerFor = (nodes: TreeNode[], selectedNodeId: string | null, activeCollectionId: string | null): string | undefined => {
  if (selectedNodeId) {
    const node = findNode(nodes, selectedNodeId)
    if (node && node.type !== 'request') return node.id
    const parent = ancestorIds(nodes, selectedNodeId)?.at(-1)
    if (parent) return parent
  }
  // Falling back to the active collection rather than the root is what keeps a new
  // request inside the collection you are looking at. Landing it at the root would
  // now make it invisible, because the tree only renders one collection's children.
  return activeCollectionId ?? undefined
}

/** Root-level collections, in order — exactly what the rail lists. */
export const collectionsIn = (nodes: TreeNode[]): CollectionNode[] => nodes.filter((n): n is CollectionNode => n.type === 'collection')

/**
 * Exactly the state environment resolution reads.
 *
 * Named for the reason `WorkspaceState` is: `environments.ts` types itself against this,
 * so a sixth field joining the resolution is a deliberate edit here rather than a silent
 * widening at a call site — and it is what makes the completeness argument in
 * `subscribeEnvironment`'s guard checkable by eye.
 */
export type ResolutionState = Pick<AppState, 'tree' | 'activeId' | 'activeCollectionId' | 'environments' | 'environmentByCollection'>

/**
 * Which collection each request belongs to, keyed by **document** id — the id `tabs`,
 * `documents` and `responses` are keyed by, not the tree node id.
 *
 * One walk for the whole tree rather than one per question, because the callers ask about
 * the active request on every store change. A request loose at the root belongs to no
 * collection and is simply absent — `adopt` prevents that shape on load and nothing in
 * the app can create it.
 */
const requestOwners = (nodes: TreeNode[]): Map<string, string> => {
  const out = new Map<string, string>()
  for (const node of nodes) {
    if (node.type !== 'collection') continue
    for (const requestId of requestIdsIn(node)) out.set(requestId, node.id)
  }
  return out
}

/**
 * The same, cached on `tree` identity.
 *
 * Cache-on-read, and keyed on the tree it is *handed* rather than on the one in the
 * store, for two reasons. Hydration replaces `tree` before `createRoot`, so a map built
 * at module load would already be stale by the first render and nothing would correct it
 * — that bug, in this exact shape, is why `readVariables` in `environments.ts` is
 * read-through too. And the subscription guard asks the same question of `state` and of
 * `previous`; a cache that read `getState()` would answer both with the current tree.
 *
 * Identity is a sound key because nothing mutates a `TreeNode` in place: `mapTree`,
 * `insertNode` and `removeNode` are all copy-on-write. `toggleNode` therefore rebuilds
 * this on every folder expand, which is exactly why the guard compares the derived
 * environment id and not `tree`.
 */
let ownerTree: TreeNode[] | null = null
let owners: ReadonlyMap<string, string> = new Map()
const ownersOf = (tree: TreeNode[]): ReadonlyMap<string, string> => {
  if (ownerTree !== tree) {
    ownerTree = tree
    owners = requestOwners(tree)
  }
  return owners
}

/** The collection a request lives in, or null when it is not in the tree. */
export const collectionOf = (state: ResolutionState, requestId: string): string | null => ownersOf(state.tree).get(requestId) ?? null

/**
 * Which collection the sidebar is *showing* — which is not the same as
 * `activeCollectionId`, and the difference is the whole reason this is a function.
 *
 * `CollectionRail`, the sidebar panel and `useTreeNavigation` each fall back to the first
 * collection when the stored id names none, so the rail can be showing `collections[0]`
 * while the field itself is null or stale. Anything that wants to say "the picker is
 * pointed somewhere other than the sidebar" has to compare against this, or it announces
 * a disagreement the user cannot see — which is exactly what the environment picker's
 * scope label did on its first outing.
 *
 * The three components still derive it themselves; they want the collection *node* and
 * are the same rail question, so pointing them here is a separate tidy-up rather than
 * part of this.
 */
export const shownCollectionId = (state: Pick<ResolutionState, 'tree' | 'activeCollectionId'>): string | null => {
  const collections = collectionsIn(state.tree)
  return (collections.find(c => c.id === state.activeCollectionId) ?? collections[0])?.id ?? null
}

/**
 * The collection whose environment is in play: the **active request's**, and only then
 * the rail's.
 *
 * The request's own, because the tab strip is not scoped — `RequestTabs` iterates `tabs`
 * unfiltered — and because `selectCollection` moves `activeCollectionId` without touching
 * `activeId`, so after a click on a rail square the active tab can belong to one
 * collection while the rail shows another. Resolving by the rail would make Ctrl+Enter
 * mean something different from what the editor is showing.
 *
 * The rail's when no request is active: there is still a picker to fill in, and the
 * rail's collection is where the next request will land — `containerFor` falls back to it
 * for exactly that reason. The `?? collections[0]` tail is the shape `CollectionRail`,
 * `Sidebar`, `useTreeNavigation` and `readPrefs` all use; they answer a *different*
 * question — which collection the sidebar is showing — and only share the shape, which is
 * why they are not unified onto this.
 *
 * Null only when there are no collections at all, which is a real state. Every consumer
 * agrees there because all of them ask this one function.
 */
export const collectionInPlay = (state: ResolutionState): string | null => {
  const own = state.activeId ? collectionOf(state, state.activeId) : null
  return own ?? shownCollectionId(state)
}



export const useAppStore = create<AppState>(set => ({
  // The app starts genuinely empty. There are no fixtures to seed from any more:
  // demo data against a domain that does not exist made every surface look
  // populated while nothing worked, and it hid the first-run experience.
  tree: [],
  documents: {},
  tabs: [],
  activeId: null,
  selectedNodeId: null,
  activeCollectionId: null,
  environments: [],
  environmentByCollection: {},
  requestPanels: {},
  responsePanels: {},
  responses: {},
  bodyViews: {},
  recentIds: [],
  ...SETTINGS_DEFAULTS,
  // Not one of them: hiding the sidebar is a workspace gesture, not a setting.
  sidebarCollapsed: false,
  responseSearch: DEFAULT_RESPONSE_SEARCH,
  update: { state: 'idle' },
  updateDismissed: false,
  paletteOpen: false,
  paletteSeed: '',
  settingsOpen: false,
  environmentsOpen: false,
  codeOpen: false,
  codeTarget: DEFAULT_SNIPPET_TARGET,
  persistenceState: 'loading',
  saveState: 'idle',
  secretsAvailable: true,
  quarantinedPath: null,
  dataDir: '',

  // `selectedNodeId` used to be derived as `node-${activeId}`, a convention that only
  // held for the seeded fixtures in data.ts. Requests created through `addNode` got
  // ids like `request-1699…`, so they never highlighted in the tree. `revealPatch`
  // looks the node up, so selection is correct for every request however it was
  // created — and the sidebar follows it into its own collection.
  openRequest: id =>
    set(s => ({
      ...revealPatch(s.tree, id, s.selectedNodeId, s.activeCollectionId),
      tabs: s.tabs.includes(id) ? s.tabs : [...s.tabs, id],
      activeId: id,
      recentIds: remember(s.recentIds, id),
    })),

  // Closing a tab is a view operation, not a delete: the request still exists in the
  // tree, so `documents[id]` stays. The stored response stays too — finding your last
  // response still there when you reopen a tab is a feature, not a leak.
  closeRequest: id =>
    set(s => {
      const index = s.tabs.indexOf(id)
      const tabs = s.tabs.filter(tab => tab !== id)
      const activeId = s.activeId === id ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : s.activeId
      return {
        tabs,
        activeId,
        recentIds: s.recentIds.filter(recent => recent !== id),
        // Only when the neighbour tab took over. Closing a background tab must not
        // move the sidebar out from under you.
        ...(activeId === s.activeId ? {} : revealPatch(s.tree, activeId, s.selectedNodeId, s.activeCollectionId)),
      }
    }),

  // The sidebar follows the tab strip: the rail switches to the request's collection
  // and its row is revealed, so what the tree shows always matches what the editor
  // holds. The command palette has done this since it existed; tabs did not.
  setActive: id =>
    set(s => ({
      ...revealPatch(s.tree, id, s.selectedNodeId, s.activeCollectionId),
      activeId: id,
      recentIds: remember(s.recentIds, id),
    })),

  // Clears the tree selection: it belonged to the collection being left, and
  // leaving it set would keep `containerFor` placing new nodes in the old one.
  selectCollection: id => set({ activeCollectionId: id, selectedNodeId: null }),

  setSaveState: saveState => set({ saveState }),
  setSecretsAvailable: secretsAvailable => set({ secretsAvailable }),

  // There is no `dirty` flag any more. Everything autosaves, so "unsaved" was a
  // state the app could no longer be in — and a confirmation dialog guarding
  // against losing changes that were already on disk was simply lying.
  updateDocument: (id, patch) => set(s => ({ documents: { ...s.documents, [id]: { ...s.documents[id], ...patch } } })),

  setRows: (id, key, rows) => set(s => ({ documents: { ...s.documents, [id]: { ...s.documents[id], [key]: rows } } })),

  // A body is now four payload fields under one `type`, so the merge that used to sit
  // loose inside the editor is an action. `updateDocument(id, { body: { ...body, ...patch } })`
  // spelled out at every call site is one forgotten spread away from clearing the rows
  // of whichever body type is not being edited.
  setBody: (id, patch) => set(s => ({ documents: { ...s.documents, [id]: { ...s.documents[id], body: { ...s.documents[id].body, ...patch } } } })),

  // The id comes from the caller rather than being minted here, so the editor has it
  // to select the new environment with — the same reason `freshRow` mints one outside
  // the store. A blank variable comes with it: never a bare column header, the rule
  // `readFormRows` and `parseParams` both state.
  addEnvironment: (id, name) =>
    set(s => ({ environments: [...s.environments, { id, name: name?.trim() || translate('data.newEnvironment'), variables: [freshVariable()] }] })),

  renameEnvironment: (id, name) => set(s => ({ environments: s.environments.map(env => (env.id === id ? { ...env, name } : env)) })),

  // Rows get fresh ids: the copy is a different environment, and two grids sharing a
  // React key across a rename would be the `revealPatch` identity problem again.
  duplicateEnvironment: (id, nextId) =>
    set(s => {
      const source = s.environments.find(env => env.id === id)
      if (!source) return {}
      const copy: Environment = {
        id: nextId,
        name: translate('data.copyOf', { name: source.name }),
        variables: source.variables.map(variable => ({ ...variable, id: crypto.randomUUID() })),
      }
      return { environments: [...s.environments, copy] }
    }),

  deleteEnvironment: id =>
    set(s => ({
      environments: s.environments.filter(env => env.id !== id),
      // Every collection that pointed at it falls to *none*, not to the next survivor —
      // the opposite of what `deleteNode` does with collections, and deliberately so. A
      // collection is a place to look, so promoting one costs nothing. An environment is
      // a host and a set of credentials, and promoting one would send some other
      // collection's next request somewhere the user never chose.
      environmentByCollection: Object.fromEntries(Object.entries(s.environmentByCollection).filter(([, envId]) => envId !== id)),
    })),

  setEnvironmentVariables: (id, variables) => set(s => ({ environments: s.environments.map(env => (env.id === id ? { ...env, variables } : env)) })),

  /**
   * Writes into the collection in play rather than taking one, so no call site can point
   * the wrong collection at an environment: the picker, the modal's header and the
   * palette rows all mean "here". A no-op with no collections — there is nothing for an
   * environment to apply to, which is the same reason the picker is disabled there.
   *
   * `null` deletes the entry rather than storing one. "No environment" is the absence of
   * a pick, so turning one off leaves nothing behind for `readPrefs` to prune later.
   */
  setActiveEnvironment: id =>
    set(s => {
      const collection = collectionInPlay(s)
      if (!collection) return {}
      if (!id) {
        const environmentByCollection = { ...s.environmentByCollection }
        delete environmentByCollection[collection]
        return { environmentByCollection }
      }
      return { environmentByCollection: { ...s.environmentByCollection, [collection]: id } }
    }),

  toggleNode: nodeId => set(s => ({ tree: mapTree(s.tree, n => (n.id === nodeId && n.type !== 'request' ? { ...n, expanded: !n.expanded } : n)) })),

  addNode: (type, parentId, name) =>
    set(s => {
      const stamp = Date.now()

      // A request or folder always ends up inside a collection, the way a channel
      // always belongs to a server. Without this an empty workspace would put the
      // first request at the root, where the collection-scoped tree cannot show it.
      let tree = s.tree
      let activeCollectionId = s.activeCollectionId
      if (type !== 'collection' && !parentId && !collectionsIn(tree).length) {
        activeCollectionId = `collection-${stamp}`
        tree = [...tree, { id: activeCollectionId, type: 'collection', name: translate('data.myCollection'), expanded: true, children: [] }]
      }

      const parent = parentId ?? containerFor(tree, s.selectedNodeId, activeCollectionId)
      if (type === 'request') {
        // The node id and the document id were both `request-${Date.now()}` in the
        // same tick, so they came out identical — a latent collision between tree
        // identity and document key. They are now distinct by construction.
        const nodeId = `node-${stamp}`
        const requestId = `request-${stamp}`
        const doc: RequestDocument = {
          id: requestId,
          kind: 'http',
          // Named in the app's language and then stored as ordinary user data, which is
          // what it is: switching language later does not rename anything that exists,
          // because by then the name is content and not copy.
          name: name?.trim() || translate('data.newRequest'),
          method: 'GET',
          // Empty rather than a `https://` stub: the input's placeholder already
          // shows the expected shape, and a prefilled scheme has to be deleted
          // before a pasted URL will go in.
          url: '',
          params: [{ id: `${requestId}-p`, enabled: true, key: '', value: '', description: '' }],
          headers: [{ id: `${requestId}-h`, enabled: true, key: '', value: '', description: '' }],
          // One blank row in each grid, for the same reason params and headers get one:
          // there has to be somewhere to start typing. A form row starts as `text`
          // because that is the half of it that can be filled in without a dialog; the
          // toggle in the row turns it into a file.
          body: {
            type: 'none',
            content: '',
            form: [{ id: `${requestId}-f`, enabled: true, kind: 'text', key: '', value: '', path: '', contentType: '' }],
            urlencoded: [{ id: `${requestId}-u`, enabled: true, key: '', value: '', description: '' }],
            file: { path: '', contentType: '' },
          },
          auth: { type: 'none', token: '', username: '', password: '' },
        }
        return {
          tree: insertNode(tree, parent, { id: nodeId, type, requestId, name: doc.name }),
          documents: { ...s.documents, [requestId]: doc },
          tabs: [...s.tabs, requestId],
          activeId: requestId,
          selectedNodeId: nodeId,
          activeCollectionId,
          recentIds: remember(s.recentIds, requestId),
        }
      }
      const id = `${type}-${stamp}`
      const child: TreeNode = {
        id,
        type,
        name: name?.trim() || translate(type === 'collection' ? 'data.newCollection' : 'data.newFolder'),
        expanded: true,
        children: [],
      }
      return {
        // A collection is always a root node, whatever happens to be selected —
        // nesting one inside a folder would hide it from the rail.
        tree: insertNode(tree, type === 'collection' ? undefined : parent, child),
        selectedNodeId: type === 'collection' ? null : id,
        // A new collection becomes the one you are looking at, so the panel is not
        // still showing the previous one's contents under its name.
        activeCollectionId: type === 'collection' ? id : activeCollectionId,
      }
    }),

  renameNode: (nodeId, name) =>
    set(s => {
      let requestId: string | undefined
      const tree = mapTree(s.tree, n => {
        if (n.id !== nodeId) return n
        if (n.type === 'request') requestId = n.requestId
        return { ...n, name }
      })
      return { tree, documents: requestId ? { ...s.documents, [requestId]: { ...s.documents[requestId], name } } : s.documents }
    }),

  // Used to touch only `tree` and `selectedNodeId`, which left the deleted request's
  // document, tab and stored response behind — you could keep editing a tab backed by
  // a document that no longer existed anywhere in the tree. Deleting a folder now
  // prunes every request beneath it, because `requestIdsIn` walks the subtree the
  // same way `removeNode` drops it.
  deleteNode: nodeId =>
    set(s => {
      const target = findNode(s.tree, nodeId)
      const removed = target ? requestIdsIn(target) : []
      const documents = { ...s.documents }
      const responses = { ...s.responses }
      const bodyViews = { ...s.bodyViews }
      const requestPanels = { ...s.requestPanels }
      const responsePanels = { ...s.responsePanels }
      // Only a collection has an entry, and node ids are unique across the tree, so this
      // needs no type test — deleting a folder or a request finds nothing to delete. And
      // no subtree sweep either, unlike `removed` above: a collection cannot be nested.
      const environmentByCollection = { ...s.environmentByCollection }
      delete environmentByCollection[nodeId]
      removed.forEach(id => {
        delete documents[id]
        delete responses[id]
        delete bodyViews[id]
        delete requestPanels[id]
        delete responsePanels[id]
      })
      const index = s.activeId ? s.tabs.indexOf(s.activeId) : -1
      const tabs = s.tabs.filter(tab => !removed.includes(tab))
      const activeId = s.activeId && removed.includes(s.activeId) ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : s.activeId

      const tree = removeNode(s.tree, nodeId)
      // Deleting the collection you were looking at has to leave the rail pointing
      // somewhere, or the panel renders under a name that no longer exists.
      const collections = collectionsIn(tree)
      const activeCollectionId =
        s.activeCollectionId && collections.some(c => c.id === s.activeCollectionId) ? s.activeCollectionId : (collections[0]?.id ?? null)

      // Was only cleared when the selection *was* the deleted node, so deleting a
      // folder left `selectedNodeId` pointing inside the subtree that just went
      // away — a dangling id that `containerFor` would then resolve against.
      const selectedNodeId = s.selectedNodeId && findNode(tree, s.selectedNodeId) ? s.selectedNodeId : null

      return {
        tree,
        documents,
        responses,
        bodyViews,
        requestPanels,
        responsePanels,
        environmentByCollection,
        tabs,
        activeId,
        activeCollectionId,
        selectedNodeId,
        recentIds: s.recentIds.filter(recent => !removed.includes(recent)),
        // Same rule as closing a tab, against the pruned tree and the already
        // validated ids: follow the request that took over, and only then — deleting
        // an unrelated folder must not yank the selection across the panel.
        ...(activeId === s.activeId ? {} : revealPatch(tree, activeId, selectedNodeId, activeCollectionId)),
      }
    }),

  /**
   * Reveal a request without activating it — the palette's "Reveal in sidebar".
   *
   * The palette's other two paths used to call this straight after `setActive` /
   * `openRequest`; they no longer need to, because those actions reveal on their own.
   */
  revealNode: requestId => set(s => revealPatch(s.tree, requestId, s.selectedNodeId, s.activeCollectionId)),

  setRequestPanel: (id, panel) => set(s => ({ requestPanels: { ...s.requestPanels, [id]: panel } })),
  setResponsePanel: (id, panel) => set(s => ({ responsePanels: { ...s.responsePanels, [id]: panel } })),
  setResponse: (id, response) => set(s => ({ responses: { ...s.responses, [id]: response } })),
  // Merged over the default rather than over the stored entry alone, so setting one
  // field on a request that has never been touched still yields a whole `BodyView`.
  setBodyView: (id, patch) => set(s => ({ bodyViews: { ...s.bodyViews, [id]: { ...DEFAULT_BODY_VIEW, ...s.bodyViews[id], ...patch } } })),

  setSidebarWidth: width => set({ sidebarWidth: Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)) }),
  toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSplitOrientation: splitOrientation => set({ splitOrientation }),
  toggleSplitOrientation: () => set(s => ({ splitOrientation: s.splitOrientation === 'rows' ? 'columns' : 'rows' })),
  setSplitRatio: ratio => set({ splitRatio: Math.min(SPLIT_RATIO.max, Math.max(SPLIT_RATIO.min, ratio)) }),
  // Stepping lives here rather than in the stepper for the same reason the split toggle
  // does: three surfaces call it — the buttons, the keyboard and the palette.
  setZoom: zoom => set({ zoom: Math.min(ZOOM.max, Math.max(ZOOM.min, zoom)) }),
  zoomIn: () => set(s => ({ zoom: stepZoom(s.zoom, 1) })),
  zoomOut: () => set(s => ({ zoom: stepZoom(s.zoom, -1) })),
  resetZoom: () => set({ zoom: ZOOM.default }),
  // No `increase`/`decrease`/`reset` beside it, unlike the zoom: those exist because three
  // surfaces step the zoom, while this has one. The stepper does the arithmetic and lets
  // the clamp here be the only thing that decides what is in range.
  setCodeFontSize: size => set({ codeFontSize: Math.min(CODE_FONT_SIZE.max, Math.max(CODE_FONT_SIZE.min, size)) }),
  setTheme: theme => set({ theme }),
  setLanguage: language => set({ language }),
  setDefaultBodyLanguage: defaultBodyLanguage => set({ defaultBodyLanguage }),
  setDefaultRedactSecrets: defaultRedactSecrets => set({ defaultRedactSecrets }),
  // One `set` is the whole feature: `initTheme`, `initLanguage`, `initZoom` and
  // `initCodeFontSize` are all subscribed and push their own field onto the document,
  // `App.tsx` reads the layout fields at render, and the autosave subscriber rewrites
  // `ui.json`. Nothing here has to know about any of that.
  resetSettings: () => set(SETTINGS_DEFAULTS),
  openPalette: (seed = '') => set({ paletteOpen: true, paletteSeed: seed }),
  closePalette: () => set({ paletteOpen: false, paletteSeed: '' }),
  // The query and its two options survive a close, so reopening with Ctrl+F puts back
  // what you were looking for — which is what every editor does and what makes the
  // shortcut worth pressing twice.
  setResponseSearch: patch => set(s => ({ responseSearch: { ...s.responseSearch, ...patch } })),
  /**
   * Clears `updateDismissed` as well: every phase change is worth surfacing, so a
   * download that starts or a failure that lands re-opens the modal even if the
   * previous phase had been closed.
   */
  setUpdate: update => set({ update, updateDismissed: false }),
  /**
   * Hides the modal without forgetting the update, so the sidebar footer can go on
   * offering it. Nothing is persisted — the next launch checks again anyway.
   */
  dismissUpdate: () => set({ updateDismissed: true }),
  reopenUpdate: () => set({ updateDismissed: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openEnvironments: () => set({ environmentsOpen: true }),
  closeEnvironments: () => set({ environmentsOpen: false }),
  openCode: () => set({ codeOpen: true }),
  closeCode: () => set({ codeOpen: false }),
  setCodeTarget: codeTarget => set({ codeTarget }),
}))

/**
 * `base?query#hash`, split once so the two directions of the URL/params sync cannot
 * disagree about where the query starts. `replaceQuery` (in `template.ts`, next to the
 * decoder that has to agree with it) writes rows into a URL and `parseParams` reads them
 * back out; both go through here.
 *
 * The fragment wins: `?a=1` after a `#` is part of the fragment, not the query.
 */
export const splitUrl = (url: string): { base: string; query: string; hash: string } => {
  const hashAt = url.indexOf('#')
  const hash = hashAt >= 0 ? url.slice(hashAt) : ''
  const clean = hashAt >= 0 ? url.slice(0, hashAt) : url
  const queryAt = clean.indexOf('?')
  return queryAt >= 0 ? { base: clean.slice(0, queryAt), query: clean.slice(queryAt + 1), hash } : { base: clean, query: '', hash }
}


/**
 * A blank grid row. Here rather than beside the grid that renders one, because a file
 * that exports both a component and a helper breaks Fast Refresh for everything
 * importing it.
 */
export const freshRow = (): KeyValueRow => ({ id: crypto.randomUUID(), enabled: true, key: '', value: '', description: '' })

/** The same, for the variable grid. Here for the reason `freshRow` is. */
export const freshVariable = (): EnvironmentVariable => ({ id: crypto.randomUUID(), enabled: true, key: '', value: '', secret: false })

export const methodOptions: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
