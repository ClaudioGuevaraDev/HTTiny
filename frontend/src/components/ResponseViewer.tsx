import { useEffect, useMemo, useState } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { Binary, Braces, Check, Code, Copy, FileJson2, FileText, FileX2, RotateCcw, Send, TriangleAlert, X } from 'lucide-react'
import { httinyTheme } from '../editorTheme'
import { formatBytes, formatDuration } from '../format'
import { BODY_LANGUAGES, BODY_MODES, DEFAULT_BODY_VIEW, formatBody, resolveLanguage } from '../responseBody'
import type { BodyLanguage, BodyView, ResponseFormat } from '../types'
import { cancelRequest, runRequest } from '../requestRunner'
import { shortcuts } from '../shortcuts'
import { useAppStore } from '../store'
import { useCopy } from '../useCopy'
import { useRovingFocus } from '../useRovingFocus'
import { Placeholder, PlaceholderAction, SkeletonLines } from './Placeholder'
import { ResponseStatus } from './ResponseStatus'

/**
 * Live elapsed time for the loading state — the only genuinely new information while
 * waiting. A progress bar would have to invent a duration that nothing can know.
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

/**
 * Module-level so the arrays are referentially stable: a fresh `extensions` array
 * on every render makes CodeMirror reconfigure itself for nothing.
 *
 * Only JSON gets a language extension. HTML and XML render as wrapped plain text
 * rather than pulling in `@codemirror/lang-html` and `lang-xml` — two more exact-
 * pinned dependencies for syntax colour on formats an HTTP client inspects far less
 * often than JSON.
 */
const JSON_EXTENSIONS = [json(), EditorView.lineWrapping]
const PLAIN_EXTENSIONS = [EditorView.lineWrapping]

const FORMAT_LABEL: Record<ResponseFormat, string> = { json: 'JSON', html: 'HTML', xml: 'XML', text: 'TEXT', binary: 'BINARY' }
const FORMAT_ICON: Record<ResponseFormat, typeof Braces> = { json: Braces, html: Code, xml: Code, text: FileText, binary: Binary }

/** Mirrors maxBodyBytes in internal/httpexec — only ever used to word the notice. */
const BODY_LIMIT = 5 * 1024 * 1024

/**
 * Was a hardcoded "JSON" label that lied about every HTML page and PNG the client
 * fetched. The exact media type is one hover away rather than in the chip, because
 * `application/json; charset=utf-8` does not fit and `JSON` is what you scan for.
 */
function FormatChip({ format, contentType }: { format: ResponseFormat; contentType: string }) {
  const Icon = FORMAT_ICON[format]
  return (
    <div className="ml-auto response-format" role="presentation" title={contentType || undefined}>
      <Icon size={13} aria-hidden="true" />
      {FORMAT_LABEL[format]}
    </div>
  )
}

const LANGUAGE_LABEL: Record<BodyLanguage, string> = { json: 'JSON', html: 'HTML', xml: 'XML', text: 'Text' }

/**
 * Takes the chip's place while the body panel is showing something an editor can
 * render. Both say what the body is; only one of them can also change it, and the
 * tabs row is too narrow in the columns layout to carry the pair.
 *
 * The picker sits on the resolved language, so the format stays readable at a glance —
 * that was the chip's whole job — and the media type the server actually sent survives
 * as the title, where the chip kept it too.
 */
function BodyControls({
  view,
  language,
  contentType,
  onChange,
}: {
  view: BodyView
  language: BodyLanguage
  contentType: string
  onChange: (patch: Partial<BodyView>) => void
}) {
  const onSegmentKeyDown = useRovingFocus('[role="radio"]')
  // Nothing else can be re-indented without pulling in a formatter per language. The
  // control stays visible and disabled rather than disappearing: a control that comes
  // and goes with the Content-Type reads as a bug.
  const canFormat = language === 'json'

  return (
    <div className="ml-auto body-controls">
      {/* A radiogroup rather than a tablist, like the request body's type picker: these
          pick how one panel renders, they do not switch between panels. */}
      <div
        className="segmented"
        role="radiogroup"
        aria-label="Body formatting"
        title={canFormat ? undefined : 'Only JSON can be reformatted'}
        onKeyDown={onSegmentKeyDown}
      >
        {BODY_MODES.map(mode => (
          <button
            type="button"
            key={mode}
            role="radio"
            aria-checked={view.mode === mode}
            disabled={!canFormat}
            tabIndex={view.mode === mode ? 0 : -1}
            className={view.mode === mode ? 'active' : ''}
            onClick={() => onChange({ mode })}
          >
            {mode === 'pretty' ? 'Pretty' : 'Raw'}
          </button>
        ))}
      </div>
      {/* Shows the resolved language, so a request nobody has configured still names
          what its body actually is — and picking one pins it from then on. */}
      <select
        className="body-language"
        aria-label="Interpret body as"
        title={contentType || undefined}
        value={language}
        onChange={event => {
          // `find` over the source of truth instead of asserting the value: the option
          // list and the union cannot drift apart, and nothing needs `as`.
          const next = BODY_LANGUAGES.find(candidate => candidate === event.target.value)
          if (next) onChange({ language: next })
        }}
      >
        {BODY_LANGUAGES.map(option => (
          <option key={option} value={option}>
            {LANGUAGE_LABEL[option]}
          </option>
        ))}
      </select>
    </div>
  )
}

export function ResponseViewer() {
  const activeId = useAppStore(s => s.activeId)
  const responsePanel = useAppStore(s => s.responsePanel)
  const setResponsePanel = useAppStore(s => s.setResponsePanel)
  const setResponse = useAppStore(s => s.setResponse)
  const stored = useAppStore(s => (s.activeId ? s.responses[s.activeId] : undefined))
  const storedView = useAppStore(s => (s.activeId ? s.bodyViews[s.activeId] : undefined))
  const setBodyView = useAppStore(s => s.setBodyView)
  const response = stored ?? { state: 'idle' as const }
  const elapsed = useElapsed(response.state === 'loading' ? response.startedAt : null)
  const { status: copyStatus, copy } = useCopy()
  const onTabsKeyDown = useRovingFocus('[role="tab"]')

  // Hooks cannot sit inside the success branch, so the inputs are read defensively and
  // the memo runs against an empty body the rest of the time — which costs nothing.
  const view = storedView ?? DEFAULT_BODY_VIEW
  const language = resolveLanguage(view, response.state === 'success' ? response.format : 'text')
  const rawBody = response.state === 'success' ? response.body : ''
  // Reparsing several MB of JSON on every render — and this component re-renders ten
  // times a second while a *later* request is in flight — is not affordable.
  const { text: bodyText, failed: formatFailed } = useMemo(() => formatBody(rawBody, language, view.mode), [rawBody, language, view.mode])

  return (
    <section className="response-viewer" aria-label="Response">
      <ResponseStatus response={response} elapsed={elapsed}>
        {response.state === 'success' && (
          <button
            type="button"
            className="icon-btn xs"
            aria-label={copyStatus === 'copied' ? 'Response body copied' : 'Copy response body'}
            title={copyStatus === 'copied' ? 'Copied' : 'Copy body'}
            /* What is on screen, not what arrived: pasting the indented body is the
               point of having indented it. */
            onClick={() => copy(bodyText)}
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
          {/* The row is not the tablist. It used to be, back when the only thing beside
              the tabs was a presentational chip; a radiogroup and a select are not
              allowed children of a tablist, and a screen reader walking one would find
              controls that have no business being there. */}
          <div className="response-tabs">
            <div className="response-tablist" role="tablist" aria-label="Response sections" onKeyDown={onTabsKeyDown}>
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
            </div>
            {responsePanel === 'body' && response.format !== 'binary' && response.body ? (
              <BodyControls view={view} language={language} contentType={response.contentType} onChange={patch => activeId && setBodyView(activeId, patch)} />
            ) : (
              <FormatChip format={response.format} contentType={response.contentType} />
            )}
          </div>
          <div className="response-content" id="response-content" role="tabpanel" aria-labelledby={`response-tab-${responsePanel}`} tabIndex={-1}>
            {responsePanel === 'body' ? (
              response.format === 'binary' ? (
                /* The bytes are deliberately never sent across the binding — a 4 MB
                   image would become 5.3 MB of string for CodeMirror to lay out, to
                   display nothing legible. Everything worth knowing is metadata. */
                <Placeholder
                  icon={<Binary size={20} />}
                  title="Binary response"
                  description={`${formatBytes(response.sizeBytes)}${response.contentType ? ` of ${response.contentType}` : ''}. Binary bodies are not sent to the viewer.`}
                />
              ) : response.body ? (
                /*
                  Read-only CodeMirror, replacing a regex highlighter that piped
                  server content through dangerouslySetInnerHTML. That highlighter
                  only coloured strings preceded by a colon, so array elements came
                  out plain and the response disagreed with the request editor about
                  what JSON looks like. Sharing httinyTheme makes them match by
                  construction, and CodeMirror renders only the visible lines rather
                  than building one enormous <pre>.
                */
                <>
                  {response.truncated && (
                    <p className="response-notice">
                      Showing the first {formatBytes(BODY_LIMIT)} of {formatBytes(response.sizeBytes)}.
                    </p>
                  )}
                  {/* Silent when the body was truncated: a cut-off body cannot parse by
                      construction, and the notice above already says why. */}
                  {formatFailed && !response.truncated && <p className="response-notice">This body is not valid JSON — showing it as it arrived.</p>}
                  <CodeMirror
                    value={bodyText}
                    theme={httinyTheme}
                    extensions={language === 'json' ? JSON_EXTENSIONS : PLAIN_EXTENSIONS}
                    editable={false}
                    basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
                  />
                </>
              ) : (
                <Placeholder
                  icon={<FileX2 size={20} />}
                  title={response.status === 204 ? '204 No Content' : 'Empty body'}
                  description={response.status === 204 ? 'The server answered without a body, by design.' : 'The response arrived with nothing in it.'}
                />
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
