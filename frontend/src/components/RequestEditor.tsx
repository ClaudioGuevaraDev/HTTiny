import { useEffect, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
import { Check, ChevronDown, Plus, Save, Send, Square, Trash2 } from 'lucide-react'
import { errorCopy, mockExecutor } from '../mockExecutor'
import { methodOptions, replaceQuery, useAppStore } from '../store'
import type { KeyValueRow, RequestDocument } from '../types'
import { methodColor } from '../types'

const freshRow = (): KeyValueRow => ({ id: crypto.randomUUID(), enabled: true, key: '', value: '', description: '' })

function KeyValueEditor({ document, field }: { document: RequestDocument; field: 'params' | 'headers' }) {
  const setRows = useAppStore(s => s.setRows)
  const updateDocument = useAppStore(s => s.updateDocument)
  const rows = document[field]
  const commit = (next: KeyValueRow[]) => {
    setRows(document.id, field, next)
    if (field === 'params') updateDocument(document.id, { url: replaceQuery(document.url, next) })
  }
  return <div className="kv-wrap">
    <div className="kv-header"><span/><span>KEY</span><span>VALUE</span><span>DESCRIPTION</span><span/></div>
    {rows.map(row => <div className="kv-row" key={row.id}>
      <button className={`row-check ${row.enabled ? 'on' : ''}`} onClick={() => commit(rows.map(r => r.id === row.id ? { ...r, enabled: !r.enabled } : r))}>{row.enabled && <Check size={11}/>}</button>
      {(['key', 'value', 'description'] as const).map(key => <input key={key} className="technical-input" value={row[key]} placeholder={key === 'key' ? 'Key' : key === 'value' ? 'Value' : 'Optional description'} onChange={e => commit(rows.map(r => r.id === row.id ? { ...r, [key]: e.target.value } : r))}/>) }
      <button className="icon-btn xs row-delete" aria-label="Delete row" onClick={() => commit(rows.filter(r => r.id !== row.id))}><Trash2 size={13}/></button>
    </div>)}
    <button className="add-row" onClick={() => commit([...rows, freshRow()])}><Plus size={13}/>Add {field === 'params' ? 'parameter' : 'header'}</button>
  </div>
}

function BodyEditor({ document }: { document: RequestDocument }) {
  const updateDocument = useAppStore(s => s.updateDocument)
  const setBody = (patch: Partial<RequestDocument['body']>) => updateDocument(document.id, { body: { ...document.body, ...patch } })
  return <div className="body-editor">
    <div className="editor-toolbar"><div className="segmented">
      {(['none', 'json', 'text'] as const).map(type => <button key={type} className={document.body.type === type ? 'active' : ''} onClick={() => setBody({ type })}>{type === 'none' ? 'None' : type.toUpperCase()}</button>)}
    </div>{document.body.type === 'json' && <button className="text-action" onClick={() => { try { setBody({ content: JSON.stringify(JSON.parse(document.body.content), null, 2) }) } catch {} }}>Format JSON</button>}</div>
    {document.body.type === 'none' ? <div className="subtle-empty">This request does not include a body.</div> : <CodeMirror value={document.body.content} height="100%" theme={oneDark} extensions={document.body.type === 'json' ? [json()] : []} onChange={content => setBody({ content })} basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}/>} 
  </div>
}

function AuthEditor({ document }: { document: RequestDocument }) {
  const updateDocument = useAppStore(s => s.updateDocument)
  const setAuth = (patch: Partial<RequestDocument['auth']>) => updateDocument(document.id, { auth: { ...document.auth, ...patch } })
  return <div className="auth-editor">
    <label>Auth type<select value={document.auth.type} onChange={e => setAuth({ type: e.target.value as RequestDocument['auth']['type'] })}><option value="none">No Auth</option><option value="bearer">Bearer Token</option><option value="basic">Basic Auth</option></select></label>
    {document.auth.type === 'none' && <p>Authentication is not configured for this request.</p>}
    {document.auth.type === 'bearer' && <label>Token<input className="technical-input" value={document.auth.token} onChange={e => setAuth({ token: e.target.value })} placeholder="Enter bearer token"/></label>}
    {document.auth.type === 'basic' && <div className="auth-grid"><label>Username<input value={document.auth.username} onChange={e => setAuth({ username: e.target.value })}/></label><label>Password<input type="password" value={document.auth.password} onChange={e => setAuth({ password: e.target.value })}/></label></div>}
  </div>
}

const parseParams = (url: string, existing: KeyValueRow[]) => {
  try {
    const parsed = new URL(url); const entries = [...parsed.searchParams.entries()]
    return entries.length ? entries.map(([key, value], i) => ({ id: existing[i]?.id ?? crypto.randomUUID(), enabled: true, key, value, description: existing[i]?.description ?? '' })) : existing.length ? existing.map(r => ({ ...r, key: '', value: '' })) : [freshRow()]
  } catch { return existing }
}

export function RequestEditor({ onController }: { onController: (controller: AbortController | null) => void }) {
  const { activeId, documents, requestPanel, setRequestPanel, updateDocument, save, responses, setResponse } = useAppStore()
  const document = activeId ? documents[activeId] : null
  const response = activeId ? responses[activeId] : undefined
  const sending = response?.state === 'loading'
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [controller])
  if (!document || !activeId) return <div className="no-request"><div className="brand-mark large">H<span>T</span></div><h2>No request open</h2><p>Select a request from the sidebar to start working.</p></div>

  const sendRequest = async () => {
    if (sending) { controller.current?.abort(); controller.current = null; onController(null); setResponse(activeId, { state: 'idle' }); return }
    const next = new AbortController(); controller.current = next; onController(next); setResponse(activeId, { state: 'loading' })
    try { setResponse(activeId, await mockExecutor.execute(document, next.signal)) }
    catch (err) { if ((err as Error).name !== 'AbortError') { const code = (err as Error).message; const copy = errorCopy[code] ?? ['Request failed', 'An unexpected error occurred.']; setResponse(activeId, { state: 'error', message: copy[0], detail: copy[1] }) } }
    finally { controller.current = null; onController(null) }
  }
  return <section className="request-editor">
    <div className="request-bar">
      <label className="method-select"><select className={methodColor[document.method]} value={document.method} onChange={e => updateDocument(activeId, { method: e.target.value as RequestDocument['method'] })}>{methodOptions.map(m => <option key={m}>{m}</option>)}</select><ChevronDown size={14}/></label>
      <input aria-label="Request URL" className="url-input" value={document.url} onChange={e => updateDocument(activeId, { url: e.target.value })} onBlur={() => useAppStore.getState().setRows(activeId, 'params', parseParams(document.url, document.params))} spellCheck={false}/>
      <button className="icon-btn save-btn" title="Save request (Ctrl+S)" onClick={() => save(activeId)}><Save size={16}/></button>
      <button className={`send-btn ${sending ? 'cancel' : ''}`} onClick={() => void sendRequest()}>{sending ? <Square size={13}/> : <Send size={15}/>} {sending ? 'Cancel' : 'Send'}</button>
    </div>
    <div className="panel-tabs">{(['params', 'headers', 'body', 'auth'] as const).map(panel => <button key={panel} className={requestPanel === panel ? 'active' : ''} onClick={() => setRequestPanel(panel)}>{panel[0].toUpperCase() + panel.slice(1)}{(panel === 'params' || panel === 'headers') && <span>{document[panel].filter(r => r.enabled && r.key).length}</span>}</button>)}</div>
    <div className="request-panel">{requestPanel === 'params' && <KeyValueEditor document={document} field="params"/>}{requestPanel === 'headers' && <KeyValueEditor document={document} field="headers"/>}{requestPanel === 'body' && <BodyEditor document={document}/>} {requestPanel === 'auth' && <AuthEditor document={document}/>}</div>
  </section>
}
