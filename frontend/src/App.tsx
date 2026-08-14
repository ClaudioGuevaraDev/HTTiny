import { useRef } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { CommandPalette } from './components/CommandPalette'
import { RequestEditor } from './components/RequestEditor'
import { RequestTabs } from './components/RequestTabs'
import { ResponseViewer } from './components/ResponseViewer'
import { Sidebar } from './components/Sidebar'
import { SplitHandle } from './components/SplitHandle'
import { WorkspaceActions } from './components/WorkspaceActions'
import { useGlobalShortcuts } from './useGlobalShortcuts'
import { useAppStore } from './store'

export function App() {
  const sidebarWidth = useAppStore(s => s.sidebarWidth)
  const setSidebarWidth = useAppStore(s => s.setSidebarWidth)
  const collapsed = useAppStore(s => s.sidebarCollapsed)
  const toggleSidebar = useAppStore(s => s.toggleSidebar)
  const splitOrientation = useAppStore(s => s.splitOrientation)
  const splitRatio = useAppStore(s => s.splitRatio)
  const setSplitRatio = useAppStore(s => s.setSplitRatio)
  const splitRef = useRef<HTMLDivElement>(null)

  useGlobalShortcuts()

  const columns = splitOrientation === 'columns'
  // At 1440×900 the workspace is 1154px wide, so a 52/48 split gives 596/553px —
  // both clear of the 360/320 minimums. Column mode is viable without a media query.
  const splitStyle = columns
    ? { gridTemplateColumns: `minmax(360px, ${splitRatio}fr) 5px minmax(320px, ${100 - splitRatio}fr)`, gridTemplateRows: 'minmax(0, 1fr)' }
    : { gridTemplateRows: `minmax(210px, ${splitRatio}fr) 5px minmax(190px, ${100 - splitRatio}fr)`, gridTemplateColumns: 'minmax(0, 1fr)' }

  return (
    /* The shell was `<main>` with the sidebar `<aside>` nested inside it, which put the
       navigation *inside* the main landmark and left the app with no main region of its
       own. The grid is now a plain div, the sidebar is `<nav>` and the workspace is
       `<main>` — three sibling landmarks, which is what the skip link jumps between. */
    <div className="app-shell" style={{ gridTemplateColumns: `${collapsed ? 48 : sidebarWidth}px 4px minmax(0, 1fr)` }}>
      <a className="skip-link" href="#workspace">
        Skip to Workspace
      </a>
      <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
      <SplitHandle label="Resize sidebar" axis="x" unit="px" value={sidebarWidth} min={220} max={420} step={16} defaultValue={282} onChange={setSidebarWidth} />
      <main className="workspace" id="workspace">
        <div className="workspace-top">
          <button
            className="icon-btn panel-toggle"
            aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
            aria-expanded={!collapsed}
            aria-controls="sidebar"
            title={collapsed ? 'Show sidebar' : 'Hide sidebar'}
            onClick={toggleSidebar}
          >
            {collapsed ? <PanelLeftOpen size={15} aria-hidden="true" /> : <PanelLeftClose size={15} aria-hidden="true" />}
          </button>
          <RequestTabs />
          <WorkspaceActions />
        </div>
        <div className="editor-split" ref={splitRef} data-orientation={splitOrientation} style={splitStyle}>
          <RequestEditor />
          <SplitHandle
            label={columns ? 'Resize request and response columns' : 'Resize request and response rows'}
            axis={columns ? 'x' : 'y'}
            unit="percent"
            value={splitRatio}
            min={30}
            max={72}
            step={4}
            defaultValue={52}
            onChange={setSplitRatio}
            containerRef={splitRef}
          />
          <ResponseViewer />
        </div>
      </main>
      <CommandPalette />
    </div>
  )
}
