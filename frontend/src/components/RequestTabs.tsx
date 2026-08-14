import { X } from 'lucide-react'
import { cancelRequest } from '../requestRunner'
import { useAppStore } from '../store'
import { MethodChip } from './MethodChip'

export function RequestTabs() {
  const tabs = useAppStore(s => s.tabs)
  const activeId = useAppStore(s => s.activeId)
  const documents = useAppStore(s => s.documents)
  const setActive = useAppStore(s => s.setActive)
  const closeRequest = useAppStore(s => s.closeRequest)

  return (
    <div className="request-tabs" role="tablist">
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
          */
          <div key={id} className={`request-tab ${id === activeId ? 'active' : ''}`}>
            <button type="button" role="tab" aria-selected={id === activeId} className="tab-main" onClick={() => setActive(id)}>
              <MethodChip method={doc.method} variant="compact" decorative />
              <span className="truncate">{doc.name}</span>
            </button>
            {doc.dirty && <span className="dirty-dot" title="Unsaved changes" />}
            <button type="button" className="tab-close" aria-label={`Close ${doc.name}`} onClick={close}>
              <X size={13} />
            </button>
          </div>
        )
      })}
      <div className="tabs-spacer" />
    </div>
  )
}
