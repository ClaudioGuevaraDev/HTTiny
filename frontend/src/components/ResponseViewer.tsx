import { useEffect, useState } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { Braces, Copy, FileJson2, RotateCcw, Send, TriangleAlert, X } from 'lucide-react'
import { httinyTheme } from '../editorTheme'
import { formatDuration } from '../format'
import { cancelRequest, runRequest } from '../requestRunner'
import { shortcuts } from '../shortcuts'
import { useAppStore } from '../store'
import { Placeholder, PlaceholderAction, SkeletonLines } from './Placeholder'
import { ResponseStatus } from './ResponseStatus'

/**
 * Live elapsed time for the loading state — the only genuinely new information while
 * waiting, and honest against a real network in a way a progress bar built on the
 * mock's fixed delay would not be.
 */
function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (startedAt === null) return
    // No priming call here: setting state in an effect body triggers a cascading
    // render. Until the first tick lands, `now` is still the previous request's
    // reading, which is behind `startedAt` and so clamps to 0 — the right thing to
    // show for the first 100ms anyway.
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [startedAt])
  return startedAt === null ? 0 : Math.max(0, now - startedAt)
}

const READ_ONLY_EXTENSIONS = [json(), EditorView.lineWrapping]

export function ResponseViewer() {
  const activeId = useAppStore(s => s.activeId)
  const responsePanel = useAppStore(s => s.responsePanel)
  const setResponsePanel = useAppStore(s => s.setResponsePanel)
  const setResponse = useAppStore(s => s.setResponse)
  const stored = useAppStore(s => (s.activeId ? s.responses[s.activeId] : undefined))
  const response = stored ?? { state: 'idle' as const }
  const elapsed = useElapsed(response.state === 'loading' ? response.startedAt : null)

  return (
    <section className="response-viewer" aria-label="Response">
      <ResponseStatus response={response} elapsed={elapsed}>
        {response.state === 'success' && (
          <button
            type="button"
            className="icon-btn xs"
            aria-label="Copy response body"
            title="Copy body"
            onClick={() => void navigator.clipboard.writeText(response.body)}
          >
            <Copy size={13} />
          </button>
        )}
        {(response.state === 'success' || response.state === 'error') && activeId && (
          <button type="button" className="icon-btn xs" aria-label="Clear response" title="Clear" onClick={() => setResponse(activeId, { state: 'idle' })}>
            <X size={13} />
          </button>
        )}
      </ResponseStatus>

      {response.state === 'idle' && (
        <Placeholder icon={<FileJson2 size={22} />} title="Nothing sent yet" description="Run this request to inspect its status, headers and body.">
          <PlaceholderAction shortcut={shortcuts.send} onClick={() => activeId && void runRequest(activeId)}>
            <Send size={13} aria-hidden="true" /> Send request
          </PlaceholderAction>
        </Placeholder>
      )}

      {response.state === 'loading' && (
        <div className="response-loading">
          <SkeletonLines count={9} />
          <p className="loading-note">Waiting for a response · {formatDuration(elapsed)}</p>
          <PlaceholderAction variant="secondary" shortcut={shortcuts.cancel} onClick={() => activeId && cancelRequest(activeId)}>
            Cancel
          </PlaceholderAction>
        </div>
      )}

      {response.state === 'error' && (
        <Placeholder tone="danger" icon={<TriangleAlert size={20} />} title={response.message} description={response.detail}>
          <PlaceholderAction shortcut={shortcuts.send} onClick={() => activeId && void runRequest(activeId)}>
            <RotateCcw size={13} aria-hidden="true" /> Retry
          </PlaceholderAction>
          {response.code === 'INVALID_URL' && (
            <PlaceholderAction variant="secondary" onClick={() => document.getElementById('request-url')?.focus()}>
              Fix the URL
            </PlaceholderAction>
          )}
          <PlaceholderAction variant="secondary" onClick={() => void navigator.clipboard.writeText(`${response.code}: ${response.detail}`)}>
            Copy details
          </PlaceholderAction>
        </Placeholder>
      )}

      {response.state === 'success' && (
        <>
          <div className="response-tabs">
            <button type="button" className={responsePanel === 'body' ? 'active' : ''} onClick={() => setResponsePanel('body')}>
              Body
            </button>
            <button type="button" className={responsePanel === 'headers' ? 'active' : ''} onClick={() => setResponsePanel('headers')}>
              Headers <span>{response.headers.length}</span>
            </button>
            <div className="ml-auto response-format">
              <Braces size={13} />
              JSON
            </div>
          </div>
          <div className="response-content">
            {responsePanel === 'body' ? (
              response.body ? (
                /*
                  Read-only CodeMirror, replacing a regex highlighter that piped
                  server content through dangerouslySetInnerHTML. That highlighter
                  only coloured strings preceded by a colon, so array elements came
                  out plain and the response disagreed with the request editor about
                  what JSON looks like. Sharing httinyTheme makes them match by
                  construction, and CodeMirror renders only the visible lines rather
                  than building one enormous <pre>.
                */
                <CodeMirror
                  value={response.body}
                  theme={httinyTheme}
                  extensions={READ_ONLY_EXTENSIONS}
                  editable={false}
                  basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
                />
              ) : (
                <div className="subtle-empty">{response.status === 204 ? 'The response body is empty (204 No Content).' : 'The response had no body.'}</div>
              )
            ) : (
              <div className="response-headers">
                <div>
                  <b>NAME</b>
                  <b>VALUE</b>
                </div>
                {response.headers.map(h => (
                  <div key={h.id}>
                    <code>{h.key}</code>
                    <code>{h.value}</code>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
