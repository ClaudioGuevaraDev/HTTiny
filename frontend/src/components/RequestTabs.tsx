import { X } from 'lucide-react'
import { methodColor } from '../types'
import { useAppStore } from '../store'

export function RequestTabs() {
  const { tabs, activeId, documents, setActive, closeRequest } = useAppStore()
  return <div className="request-tabs" role="tablist">
    {tabs.map(id => { const doc = documents[id]; if (!doc) return null; return <button key={id} role="tab" aria-selected={id === activeId} className={`request-tab ${id === activeId ? 'active' : ''}`} onClick={() => setActive(id)}>
      <span className={`method-dot ${methodColor[doc.method]}`}>{doc.method.slice(0, 1)}</span><span className="truncate">{doc.name}</span>
      {doc.dirty && <span className="dirty-dot" title="Unsaved changes"/>}
      <span className="tab-close" role="button" aria-label={`Close ${doc.name}`} onClick={e => { e.stopPropagation(); if (!doc.dirty || window.confirm(`Close ${doc.name} without saving?`)) closeRequest(id) }}><X size={13}/></span>
    </button> })}
    <div className="tabs-spacer"/>
  </div>
}
