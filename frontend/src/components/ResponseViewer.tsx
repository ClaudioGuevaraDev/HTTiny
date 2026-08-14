import { useEffect, useState } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { Braces, Check, Copy, FileJson2, RotateCcw, Send, TriangleAlert, X } from 'lucide-react'
import { httinyTheme } from '../editorTheme'
import { formatDuration } from '../format'
import { cancelRequest, runRequest } from '../requestRunner'
import { shortcuts } from '../shortcuts'
import { useAppStore } from '../store'
import { useCopy } from '../useCopy'
import { useRovingFocus } from '../useRovingFocus'
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
  const { status: copyStatus, copy } = useCopy()
  const onTabsKeyDown = useRovingFocus('[role="tab"]')

  return (
    <section className="response-viewer" aria-label="Response">
      <ResponseStatus response={response} elapsed={elapsed}>
        {response.state === 'success' && (
          <button
            type="button"
            className="icon-btn xs"
            aria-label={copyStatus === 'copied' ? 'Response body copied' : 'Copy response body'}
            title={copyStatus === 'copied' ? 'Copied' : 'Copy body'}
            onClick={() => copy(response.body)}
          >
            {copyStatus === 'copied' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          </button>
        )}
        {(response.state === 'success' || response.state === 'error') && activeId && (
          <button type="button" className="icon-btn xs" aria-label="Clear response" title="Clear" onClick={() => setResponse(activeId, { state: 'idle' })}>
            <X size={13} aria-hidden="true" />
          </button>
        )}
      </ResponseStatus>

      {/* One region for both copy buttons. The clipboard write used to be a bare `void`
          call: nothing moved on screen, nothing was announced, and a rejected promise —
          a denied clipboard permission — was indistinguishable from success. */}
      <p className="sr-only" role="status" aria-live="polite">
        {copyStatus === 'copied' ? 'Copied to clipboard' : copyStatus === 'failed' ? 'Could not copy — clipboard access was denied' : ''}
      </p>

      {response.state === 'idle' && (
        <Placeholder icon={<FileJson2 size={22} />} title="Nothing sent yet" description="Run this request to inspect its status, headers and body.">
          <PlaceholderAction shortcut={shortcuts.send} onClick={() => activeId && void runRequest(activeId)}>
            <Send size={13} aria-hidden="true" /> Send request
          </PlaceholderAction>
        </Placeholder>
      )}

      {response.state === 'loading' && (
        <div className="response-loading" aria-busy="true">
          <SkeletonLines count={9} />
          <p className="loading-note">Waiting for a response… · {formatDuration(elapsed)}</p>
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
          <PlaceholderAction variant="secondary" onClick={() => copy(`${response.code}: ${response.detail}`)}>
            {copyStatus === 'copied' ? 'Copied' : 'Copy Details'}
          </PlaceholderAction>
        </Placeholder>
      )}

      {response.state === 'success' && (
        <>
          <div className="response-tabs" role="tablist" aria-label="Response sections" onKeyDown={onTabsKeyDown}>
            <button
              type="button"
              role="tab"
              id="response-tab-body"
              aria-selected={responsePanel === 'body'}
              aria-controls="response-content"
              tabIndex={responsePanel === 'body' ? 0 : -1}
              className={responsePanel === 'body' ? 'active' : ''}
              onClick={() => setResponsePanel('body')}
            >
              Body
            </button>
            <button
              type="button"
              role="tab"
              id="response-tab-headers"
              aria-selected={responsePanel === 'headers'}
              aria-controls="response-content"
              tabIndex={responsePanel === 'headers' ? 0 : -1}
              className={responsePanel === 'headers' ? 'active' : ''}
              onClick={() => setResponsePanel('headers')}
            >
              Headers <span aria-hidden="true">{response.headers.length}</span>
              <span className="sr-only">, {response.headers.length} returned</span>
            </button>
            <div className="ml-auto response-format" role="presentation">
              <Braces size={13} aria-hidden="true" />
              JSON
            </div>
          </div>
          <div className="response-content" id="response-content" role="tabpanel" aria-labelledby={`response-tab-${responsePanel}`} tabIndex={-1}>
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
              /* A real table, not a grid of divs with <b> for column heads. Name/value
                 pairs are tabular data, and a screen reader can only navigate them
                 column-by-column if the markup says so. */
              <table className="response-headers">
                <caption className="sr-only">Response headers</caption>
                <thead>
                  <tr>
                    <th scope="col">NAME</th>
                    <th scope="col">VALUE</th>
                  </tr>
                </thead>
                <tbody>
                  {response.headers.map(h => (
                    <tr key={h.id}>
                      <td>
                        <code>{h.key}</code>
                      </td>
                      <td>
                        <code>{h.value}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  )
}
