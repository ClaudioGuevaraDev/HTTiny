import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { CaseSensitive, ChevronDown, ChevronUp, Regex, Search, X } from 'lucide-react'
import { useT } from '../../language'
import { MAX_MATCHES } from '../../response/search'
import { useAppStore } from '../../store'

/**
 * The response viewer's find bar.
 *
 * Replaces CodeMirror's own search panel, which this app was reaching by synthesising a
 * fake Ctrl+F `KeyboardEvent` and firing it at a `.cm-content` node found by selector.
 * That panel only ever covered the body, only responded when the editor already had
 * focus, and rendered with CodeMirror's stock styling — `editorTheme.ts` themes
 * `.cm-panels` and nothing inside it, so its input and buttons ignored the light theme
 * entirely.
 *
 * Owns no search state of its own. The query and both toggles live in the store,
 * because the bar is opened from three places — the global shortcut, the command
 * palette, and itself — and two of them cannot reach a `useState` in here. Matching is
 * the viewer's job: it holds the body text, and the headers tab has no editor at all.
 */
export function ResponseSearchBar({
  total,
  active,
  searchable,
  onStep,
  onShowAsText,
}: {
  total: number
  /** Zero-based index of the current match; ignored when `total` is 0. */
  active: number
  /** False for the views that cannot be traversed — tree, table, hex, preview. */
  searchable: boolean
  onStep: (delta: number) => void
  onShowAsText: () => void
}) {
  const { t } = useT()
  const search = useAppStore(s => s.responseSearch)
  const setResponseSearch = useAppStore(s => s.setResponseSearch)
  const input = useRef<HTMLInputElement>(null)

  // Focused and selected on open, so a second Ctrl+F over an existing query replaces it
  // by typing rather than making the user clear it first. `select` on an empty value is
  // a no-op, so the first open needs no special case.
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  const close = () => setResponseSearch({ open: false })

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      // Both matter, and for the reason `Select.tsx` documents on its own Escape branch:
      // `useGlobalShortcuts` aborts the in-flight request on a bare Escape, so without
      // stopping propagation, dismissing this bar over a running send would cancel it.
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      onStep(event.shiftKey ? -1 : 1)
    }
  }

  return (
    <div className="response-search" role="search">
      <div className="response-search-field">
        <Search size={13} aria-hidden="true" />
        <input
          ref={input}
          type="text"
          className="response-search-input"
          value={search.query}
          spellCheck={false}
          autoComplete="off"
          aria-label={t('response.search.aria')}
          placeholder={t('response.search.placeholder')}
          onChange={event => setResponseSearch({ query: event.target.value })}
          onKeyDown={onKeyDown}
        />
        {/* Announced politely rather than on every keystroke of the field itself: the
            count is the answer to what was typed, and it settles a beat later. */}
        <p className="response-search-count" role="status" aria-live="polite">
          {!search.query ? '' : total === 0 ? t('response.search.none') : t('response.search.count', { index: active + 1, total })}
        </p>
      </div>

      <button
        type="button"
        className="icon-btn xs"
        disabled={total === 0}
        aria-label={t('response.search.previous')}
        title={t('response.search.previous')}
        onClick={() => onStep(-1)}
      >
        <ChevronUp size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="icon-btn xs"
        disabled={total === 0}
        aria-label={t('response.search.next')}
        title={t('response.search.next')}
        onClick={() => onStep(1)}
      >
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={search.caseSensitive ? 'icon-btn xs active' : 'icon-btn xs'}
        aria-pressed={search.caseSensitive}
        aria-label={t('response.search.caseSensitive')}
        title={t('response.search.caseSensitive')}
        onClick={() => setResponseSearch({ caseSensitive: !search.caseSensitive })}
      >
        <CaseSensitive size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={search.regexp ? 'icon-btn xs active' : 'icon-btn xs'}
        aria-pressed={search.regexp}
        aria-label={t('response.search.regexp')}
        title={t('response.search.regexp')}
        onClick={() => setResponseSearch({ regexp: !search.regexp })}
      >
        <Regex size={13} aria-hidden="true" />
      </button>

      <button type="button" className="icon-btn xs" aria-label={t('response.search.close')} title={t('response.search.close')} onClick={close}>
        <X size={13} aria-hidden="true" />
      </button>

      {/* The bar opens over every view, including the ones it cannot traverse — and says
          so, with the way out. Refusing to open would be the version of this that leaves
          you pressing a shortcut that appears to do nothing. */}
      {!searchable && (
        <p className="response-search-notice">
          {t('response.search.unsearchable')}
          <button type="button" className="link-btn" onClick={onShowAsText}>
            {t('response.search.showAsText')}
          </button>
        </p>
      )}
      {total >= MAX_MATCHES && <p className="response-search-notice">{t('response.search.capped', { limit: MAX_MATCHES })}</p>}
    </div>
  )
}
