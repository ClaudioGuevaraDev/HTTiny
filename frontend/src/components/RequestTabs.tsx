import { X } from 'lucide-react'
import { requestTabId } from '../domIds'
import { cancelRequest } from '../requestRunner'
import { useAppStore } from '../store'
import { useRovingFocus } from '../useRovingFocus'
import { MethodChip } from './MethodChip'

export function RequestTabs() {
  const tabs = useAppStore(s => s.tabs)
  const activeId = useAppStore(s => s.activeId)
  const documents = useAppStore(s => s.documents)
  const setActive = useAppStore(s => s.setActive)
  const closeRequest = useAppStore(s => s.closeRequest)
  const onKeyDown = useRovingFocus('[role="tab"]')

  return (
    <div className="request-tabs" role="tablist" aria-label="Open requests" onKeyDown={onKeyDown}>
      {tabs.map(id => {
        const doc = documents[id]
        if (!doc) return null
        const close = () => {
          if (doc.dirty && !window.confirm(`Discard unsaved changes to “${doc.name}”?`)) return
          cancelRequest(id)
          closeRequest(id)
        }
        return (
          /*
            This was one <button> containing a nested <span role="button"> for the
            close control: invalid HTML, and assistive tech announced the pair as a
            single control. It is now a plain container with two real sibling
            buttons, so each is separately reachable and labelled.

            The container is `presentation` because a tablist may only contain tabs, and
            the close button is not one. Arrow keys move between tabs; the active tab is
            the strip's only tab stop, and activation is manual (Enter or Space) so
            arrowing past a request does not load it.
          */
          <div key={id} role="presentation" className={`request-tab ${id === activeId ? 'active' : ''}`}>
            <button
              type="button"
              role="tab"
              id={requestTabId(id)}
              aria-selected={id === activeId}
              aria-controls="request-editor-panel"
              tabIndex={id === activeId ? 0 : -1}
              className="tab-main"
              onClick={() => setActive(id)}
            >
              <MethodChip method={doc.method} variant="compact" decorative />
              <span className="truncate">{doc.name}</span>
              {doc.dirty && <span className="sr-only">, unsaved changes</span>}
            </button>
            {doc.dirty && <span className="dirty-dot" aria-hidden="true" />}
            <button type="button" className="tab-close" aria-label={`Close ${doc.name}`} onClick={close}>
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        )
      })}
      <div role="presentation" className="tabs-spacer" />
    </div>
  )
}
