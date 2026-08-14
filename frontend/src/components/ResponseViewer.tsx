import { AlertTriangle, Braces, Clock3, Database, FileJson2, LoaderCircle, RotateCcw } from 'lucide-react'
import { useAppStore } from '../store'

function HighlightedJson({ value }: { value: string }) {
  if (!value) return <div className="subtle-empty">The response has no body.</div>
  const html = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/("(?:\\.|[^"\\])*")(?=\s*:)/g, '<span class="json-key">$1</span>')
    .replace(/:\s*("(?:\\.|[^"\\])*")/g, ': <span class="json-string">$1</span>')
    .replace(/\b(true|false|null)\b/g, '<span class="json-literal">$1</span>')
    .replace(/\b(-?\d+(?:\.\d+)?)\b/g, '<span class="json-number">$1</span>')
  return <pre className="response-code" dangerouslySetInnerHTML={{ __html: html }}/>
}

export function ResponseViewer() {
  const { activeId, responses, responsePanel, setResponsePanel, setResponse } = useAppStore()
  const response = activeId ? responses[activeId] : undefined
  const current = response ?? { state: 'idle' as const }
  return <section className="response-viewer">
    <header className="response-header"><strong>Response</strong>
      {current.state === 'success' && <div className="response-meta"><span className={`status ${current.status < 300 ? 'ok' : 'bad'}`}>{current.status} {current.statusText}</span><span><Clock3 size={13}/>{current.time} ms</span><span><Database size={13}/>{current.size}</span></div>}
      {current.state === 'error' && <span className="failed-label">Request failed</span>}
    </header>
    {current.state === 'idle' && <div className="response-empty"><div className="empty-icon"><FileJson2 size={24}/></div><h3>Ready when you are</h3><p>Send a request to inspect its response.</p><kbd>Ctrl ↵</kbd></div>}
    {current.state === 'loading' && <div className="response-empty loading"><LoaderCircle size={27}/><h3>Sending request…</h3><p>Waiting for the server to respond.</p></div>}
    {current.state === 'error' && <div className="response-error"><div className="error-symbol"><AlertTriangle size={20}/></div><div><h3>{current.message}</h3><p>{current.detail}</p>{activeId && <button onClick={() => setResponse(activeId, { state: 'idle' })}><RotateCcw size={13}/>Dismiss</button>}</div></div>}
    {current.state === 'success' && <>
      <div className="response-tabs"><button className={responsePanel === 'body' ? 'active' : ''} onClick={() => setResponsePanel('body')}>Body</button><button className={responsePanel === 'headers' ? 'active' : ''} onClick={() => setResponsePanel('headers')}>Headers <span>{current.headers.length}</span></button><div className="ml-auto response-format"><Braces size={13}/>JSON</div></div>
      <div className="response-content">{responsePanel === 'body' ? <HighlightedJson value={current.body}/> : <div className="response-headers"><div><b>NAME</b><b>VALUE</b></div>{current.headers.map(h => <div key={h.id}><code>{h.key}</code><code>{h.value}</code></div>)}</div>}</div>
    </>}
  </section>
}
