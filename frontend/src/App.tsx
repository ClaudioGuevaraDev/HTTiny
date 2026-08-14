import { useCallback, useEffect, useRef, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { RequestEditor } from './components/RequestEditor'
import { RequestTabs } from './components/RequestTabs'
import { ResponseViewer } from './components/ResponseViewer'
import { Sidebar } from './components/Sidebar'
import { useAppStore } from './store'

export function App() {
  const [sidebarWidth, setSidebarWidth] = useState(282)
  const [collapsed, setCollapsed] = useState(false)
  const [requestHeight, setRequestHeight] = useState(52)
  const abortRef = useRef<AbortController | null>(null)
  const { activeId, save, closeRequest, responses } = useAppStore()
  const dragSidebar = useCallback((event: React.PointerEvent) => {
    const startX = event.clientX; const start = sidebarWidth
    const move = (e: PointerEvent) => setSidebarWidth(Math.min(420, Math.max(220, start + e.clientX - startX)))
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop)
  }, [sidebarWidth])
  const dragSplit = useCallback((event: React.PointerEvent) => {
    const shell = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect(); const startY = event.clientY; const start = requestHeight
    const move = (e: PointerEvent) => setRequestHeight(Math.min(72, Math.max(30, start + ((e.clientY - startY) / shell.height) * 100)))
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop)
  }, [requestHeight])

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.key.toLowerCase() === 's' && activeId) { event.preventDefault(); save(activeId) }
      if (modifier && event.key.toLowerCase() === 'w' && activeId) { event.preventDefault(); const doc = useAppStore.getState().documents[activeId]; if (!doc.dirty || window.confirm(`Close ${doc.name} without saving?`)) closeRequest(activeId) }
      if (modifier && event.key === 'Enter' && activeId) { event.preventDefault(); document.querySelector<HTMLButtonElement>('.send-btn')?.click() }
      if (event.key === 'Escape' && responses[activeId ?? '']?.state === 'loading') abortRef.current?.abort()
    }
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle)
  }, [activeId, closeRequest, responses, save])

  return <main className="app-shell" style={{ gridTemplateColumns: `${collapsed ? 48 : sidebarWidth}px 4px minmax(0, 1fr)` }}>
    <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)}/>
    <div className="sidebar-resizer" onPointerDown={collapsed ? undefined : dragSidebar}/>
    <section className="workspace">
      <div className="workspace-top"><button className="icon-btn panel-toggle" title={collapsed ? 'Show sidebar' : 'Hide sidebar'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={15}/> : <PanelLeftClose size={15}/>}</button><RequestTabs/></div>
      <div className="editor-split" style={{ gridTemplateRows: `minmax(210px, ${requestHeight}fr) 5px minmax(190px, ${100 - requestHeight}fr)` }}>
        <RequestEditor onController={controller => { abortRef.current = controller }}/>
        <div className="horizontal-resizer" onPointerDown={dragSplit}><span/></div>
        <ResponseViewer/>
      </div>
    </section>
  </main>
}
