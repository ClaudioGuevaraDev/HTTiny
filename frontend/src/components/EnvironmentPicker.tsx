import { Layers } from 'lucide-react'
import { useT } from '../language'
import { shortcutHint } from '../shortcuts'
import { applicableEnvironmentId } from '../environments'
import { collectionInPlay, shownCollectionId, useAppStore } from '../store'
import { Select } from './Select'

/**
 * Which environment `{{variables}}` resolve against, at the right end of the tab strip.
 *
 * Two controls rather than one. `Select` is a select-only combobox whose options are
 * *values*, so smuggling a "Manage environments…" row in as an option would break that
 * contract and need a sentinel value threaded through `onChange`.
 *
 * The empty string stands in for "no environment", the idiom the response viewer's
 * format picker already uses for "automatic": an id is minted as `env-<stamp>`, so `''`
 * is unclaimable and needs no case of its own on the way out. It has to be an option —
 * turning every variable off at once is how you find out whether a request depends on
 * them, and it is what you want before copying a snippet into a ticket.
 *
 * With no environments the picker is disabled rather than hidden, which is the rule
 * `Select` states for `disabled` and the segmented pickers beside it already follow: a
 * control that vanishes when it stops applying reads as a bug.
 */
export function EnvironmentPicker() {
  const { t } = useT()
  const environments = useAppStore(s => s.environments)
  // The **active request's** collection, not the rail's. The tab strip is not scoped —
  // `RequestTabs` iterates `tabs` unfiltered — so what this shows has to be what the next
  // Ctrl+Enter uses, or the control is decorative.
  const collectionId = useAppStore(collectionInPlay)
  // What the rail is *showing*, not `activeCollectionId`: the rail falls back to the
  // first collection when that field names none, so comparing against the raw field
  // would announce a disagreement the user cannot see.
  const shownId = useAppStore(shownCollectionId)
  // Collections are always root nodes, so a `find` over the top level is the whole
  // lookup; `findNode`'s recursion would be answering a question that cannot arise.
  const collectionName = useAppStore(s => s.tree.find(node => node.id === collectionId)?.name ?? '')
  // The validated id, not `environmentByCollection[collectionId]`: a `Select` whose value
  // names no option renders blank, and a stale entry has to read as "no environment".
  const value = useAppStore(applicableEnvironmentId)
  const setActiveEnvironment = useAppStore(s => s.setActiveEnvironment)
  const openEnvironments = useAppStore(s => s.openEnvironments)

  // Naming the collection, because the meaning narrowed: "Active environment" was true of
  // the whole workspace and is now true of one collection, whose rail square can be
  // scrolled out of view.
  const label = collectionName ? t('env.picker.scoped.aria', { name: collectionName }) : t('env.picker.aria')
  const scoped = Boolean(environments.length && collectionId && collectionId !== shownId)

  return (
    <div className="env-picker">
      {/* The collection's name, and only when it carries information: there is a pick to
          be scoped, and the scope is not what the sidebar is showing. That second half is
          the state this design creates — a tab from one collection active while the rail
          shows another — and the first half is the half I got wrong: with no environments
          defined the picker is inert, and a scope label beside a dead control explains
          nothing while looking like a glitch.

          Carries the same title as the trigger, because a bare collection name in the top
          bar is not self-describing. */}
      {scoped && (
        <span className="env-scope truncate" title={label}>
          {collectionName}
        </span>
      )}
      <Select
        variant="inline"
        ariaLabel={label}
        title={label}
        // Disabled with no environments to choose from — the rule `Select` states and the
        // segmented pickers follow — and with no collection to choose *for*, where
        // `setActiveEnvironment` is a no-op by construction. A live control that does
        // nothing is worse than a greyed one.
        disabled={!environments.length || !collectionId}
        value={value ?? ''}
        options={[{ value: '', label: t('env.picker.none') }, ...environments.map(env => ({ value: env.id, label: env.name }))]}
        onChange={next => setActiveEnvironment(next || null)}
      />
      <button
        type="button"
        className="icon-btn"
        aria-label={t('env.manage.aria')}
        title={t('env.manage.title', { keys: shortcutHint('environments') })}
        onClick={openEnvironments}
      >
        <Layers size={15} />
      </button>
    </div>
  )
}
