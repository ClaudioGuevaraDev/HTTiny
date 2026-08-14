import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { Check, ChevronDown, Plus, Save, Search, Send, Square, Trash2 } from 'lucide-react'
import { httinyTheme } from '../editorTheme'
import { toggleRequest } from '../requestRunner'
import { shortcutHint, shortcuts } from '../shortcuts'
import { methodOptions, replaceQuery, useAppStore } from '../store'
import { methodToken, type HttpMethod, type KeyValueRow, type RequestDocument } from '../types'
import { MethodChip } from './MethodChip'
import { Placeholder, PlaceholderAction } from './Placeholder'

const freshRow = (): KeyValueRow => ({ id: crypto.randomUUID(), enabled: true, key: '', value: '', description: '' })

function KeyValueEditor({ request, field }: { request: RequestDocument; field: 'params' | 'headers' }) {
  const setRows = useAppStore(s => s.setRows)
  const updateDocument = useAppStore(s => s.updateDocument)
  const rows = request[field]
  const commit = (next: KeyValueRow[]) => {
    setRows(request.id, field, next)
    if (field === 'params') updateDocument(request.id, { url: replaceQuery(request.url, next) })
  }
  return (
    <div className="kv-wrap">
      <div className="kv-header">
        <span />
        <span>KEY</span>
        <span>VALUE</span>
        <span>DESCRIPTION</span>
        <span />
      </div>
      {rows.map(row => (
        <div className="kv-row" key={row.id}>
          <button
            type="button"
            className={`row-check ${row.enabled ? 'on' : ''}`}
            role="switch"
            aria-checked={row.enabled}
            aria-label={row.key ? `Enable ${row.key}` : 'Enable row'}
            onClick={() => commit(rows.map(r => (r.id === row.id ? { ...r, enabled: !r.enabled } : r)))}
          >
            {row.enabled && <Check size={11} />}
          </button>
          {(['key', 'value', 'description'] as const).map(key => (
            <input
              key={key}
              className="technical-input"
              value={row[key]}
              aria-label={key === 'key' ? 'Key' : key === 'value' ? 'Value' : 'Description'}
              placeholder={key === 'key' ? 'Key' : key === 'value' ? 'Value' : 'Optional description'}
              onChange={e => commit(rows.map(r => (r.id === row.id ? { ...r, [key]: e.target.value } : r)))}
            />
          ))}
          <button type="button" className="icon-btn xs row-delete" aria-label="Delete row" onClick={() => commit(rows.filter(r => r.id !== row.id))}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button type="button" className="add-row" onClick={() => commit([...rows, freshRow()])}>
        <Plus size={13} />
        Add {field === 'params' ? 'parameter' : 'header'}
      </button>
    </div>
  )
}

function BodyEditor({ request }: { request: RequestDocument }) {
  const updateDocument = useAppStore(s => s.updateDocument)
  const setBody = (patch: Partial<RequestDocument['body']>) => updateDocument(request.id, { body: { ...request.body, ...patch } })
  return (
    <div className="body-editor">
      <div className="editor-toolbar">
        <div className="segmented">
          {(['none', 'json', 'text'] as const).map(type => (
            <button type="button" key={type} className={request.body.type === type ? 'active' : ''} onClick={() => setBody({ type })}>
              {type === 'none' ? 'None' : type.toUpperCase()}
            </button>
          ))}
        </div>
        {request.body.type === 'json' && (
          <button
            type="button"
            className="text-action"
            onClick={() => {
              try {
                setBody({ content: JSON.stringify(JSON.parse(request.body.content), null, 2) })
              } catch {
                /* Leave malformed JSON alone rather than destroying what was typed. */
              }
            }}
          >
            Format JSON
          </button>
        )}
      </div>
      {request.body.type === 'none' ? (
        <div className="subtle-empty">No body. Pick JSON or Text to add one.</div>
      ) : (
        <CodeMirror
          value={request.body.content}
          height="100%"
          theme={httinyTheme}
          extensions={request.body.type === 'json' ? [json()] : []}
          onChange={content => setBody({ content })}
          basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
        />
      )}
    </div>
  )
}

function AuthEditor({ request }: { request: RequestDocument }) {
  const updateDocument = useAppStore(s => s.updateDocument)
  const setAuth = (patch: Partial<RequestDocument['auth']>) => updateDocument(request.id, { auth: { ...request.auth, ...patch } })
  return (
    <div className="auth-editor">
      <label>
        Auth type
        <select value={request.auth.type} onChange={e => setAuth({ type: e.target.value as RequestDocument['auth']['type'] })}>
          <option value="none">No Auth</option>
          <option value="bearer">Bearer Token</option>
          <option value="basic">Basic Auth</option>
        </select>
      </label>
      {request.auth.type === 'none' && <p>No auth. Requests are sent without credentials.</p>}
      {request.auth.type === 'bearer' && (
        <label>
          Token
          <input className="technical-input" value={request.auth.token} onChange={e => setAuth({ token: e.target.value })} placeholder="Enter bearer token" />
        </label>
      )}
      {request.auth.type === 'basic' && (
        <div className="auth-grid">
          <label>
            Username
            <input value={request.auth.username} onChange={e => setAuth({ username: e.target.value })} />
          </label>
          <label>
            Password
            <input type="password" value={request.auth.password} onChange={e => setAuth({ password: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  )
}

const parseParams = (url: string, existing: KeyValueRow[]) => {
  try {
    const parsed = new URL(url)
    const entries = [...parsed.searchParams.entries()]
    return entries.length
      ? entries.map(([key, value], i) => ({
          id: existing[i]?.id ?? crypto.randomUUID(),
          enabled: true,
          key,
          value,
          description: existing[i]?.description ?? '',
        }))
      : existing.length
        ? existing.map(r => ({ ...r, key: '', value: '' }))
        : [freshRow()]
  } catch {
    return existing
  }
}

export function RequestEditor() {
  const activeId = useAppStore(s => s.activeId)
  const request = useAppStore(s => (s.activeId ? s.documents[s.activeId] : undefined))
  const requestPanel = useAppStore(s => s.requestPanel)
  const setRequestPanel = useAppStore(s => s.setRequestPanel)
  const updateDocument = useAppStore(s => s.updateDocument)
  const save = useAppStore(s => s.save)
  const addNode = useAppStore(s => s.addNode)
  const openPalette = useAppStore(s => s.openPalette)
  const sending = useAppStore(s => (s.activeId ? s.responses[s.activeId]?.state === 'loading' : false))

  if (!request || !activeId)
    return (
      <div className="request-editor">
        <Placeholder
          icon={
            <div className="brand-mark large">
              H<span>T</span>
            </div>
          }
          title="No request open"
          description="Open something from the sidebar, or start a new request."
        >
          <PlaceholderAction shortcut={shortcuts.newRequest} onClick={() => addNode('request')}>
            New request
          </PlaceholderAction>
          <PlaceholderAction variant="secondary" shortcut={shortcuts.palette} onClick={() => openPalette('')}>
            <Search size={13} aria-hidden="true" /> Search requests
          </PlaceholderAction>
        </Placeholder>
      </div>
    )

  return (
    <section className="request-editor">
      <div className="request-bar">
        {/*
          The native select is kept for keyboard and screen-reader behaviour and
          rendered transparently over the chip. The chip is aria-hidden because the
          select already exposes the value — without that it is announced twice.
        */}
        <div className={`method-field method-${methodToken(request.method)}`} data-method={methodToken(request.method)}>
          <MethodChip method={request.method} variant="ghost" decorative />
          <ChevronDown size={12} aria-hidden="true" />
          <select
            className="method-native"
            aria-label="HTTP method"
            value={request.method}
            onChange={e => updateDocument(activeId, { method: e.target.value as HttpMethod })}
          >
            {methodOptions.map(m => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        {/* A stable id, so the INVALID_URL placeholder can focus this field without
            reaching for a class selector the way Ctrl+Enter used to. */}
        <input
          id="request-url"
          aria-label="Request URL"
          className="url-input"
          value={request.url}
          onChange={e => updateDocument(activeId, { url: e.target.value })}
          onBlur={() => useAppStore.getState().setRows(activeId, 'params', parseParams(request.url, request.params))}
          spellCheck={false}
        />
        <button type="button" className="icon-btn save-btn" title={`Save request (${shortcutHint('save')})`} onClick={() => save(activeId)}>
          <Save size={16} />
        </button>
        <button
          type="button"
          className={`send-btn ${sending ? 'cancel' : ''}`}
          title={sending ? `Cancel request (${shortcutHint('cancel')})` : `Send request (${shortcutHint('send')})`}
          onClick={() => toggleRequest(activeId)}
        >
          {sending ? <Square size={13} /> : <Send size={15} />} {sending ? 'Cancel' : 'Send'}
        </button>
      </div>
      <div className="panel-tabs">
        {(['params', 'headers', 'body', 'auth'] as const).map(panel => (
          <button type="button" key={panel} className={requestPanel === panel ? 'active' : ''} onClick={() => setRequestPanel(panel)}>
            {panel[0].toUpperCase() + panel.slice(1)}
            {(panel === 'params' || panel === 'headers') && <span>{request[panel].filter(r => r.enabled && r.key).length}</span>}
          </button>
        ))}
      </div>
      <div className="request-panel">
        {requestPanel === 'params' && <KeyValueEditor request={request} field="params" />}
        {requestPanel === 'headers' && <KeyValueEditor request={request} field="headers" />}
        {requestPanel === 'body' && <BodyEditor request={request} />}
        {requestPanel === 'auth' && <AuthEditor request={request} />}
      </div>
    </section>
  )
}
