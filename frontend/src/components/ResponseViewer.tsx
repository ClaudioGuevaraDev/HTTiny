import { useEffect, useMemo, useState } from 'react'
import {
  Binary,
  Braces,
  Check,
  Code,
  Copy,
  FileArchive,
  FileAudio,
  FileJson2,
  FileText,
  FileType,
  FileVideo,
  Image,
  Radio,
  RotateCcw,
  Search,
  Send,
  Shapes,
  Table,
  TriangleAlert,
  Type,
  WrapText,
  X,
} from 'lucide-react'
import { errorCopy } from '../errors'
import { formatDuration } from '../format'
import { useLocale, useT } from '../language'
import {
  BODY_LANGUAGES,
  BODY_MODES,
  DEFAULT_BODY_VIEW,
  bodyLanguageLabel,
  canFormat,
  formatBody,
  hasRichView,
  resolveLanguage,
  resolveMode,
  richLabel,
} from '../responseBody'
import { isByteFormat } from '../types'
import type { BodyLanguage, BodyMode, BodyView, ResponseFormat } from '../types'
import { cancelRequest, runRequest } from '../requestRunner'
import { shortcuts } from '../shortcuts'
import { useAppStore } from '../store'
import { useCopy } from '../useCopy'
import { useRovingFocus } from '../useRovingFocus'
import { BodyPanel } from './response/BodyPanel'
import { Placeholder, PlaceholderAction, SkeletonLines } from './Placeholder'
import { ResponseStatus } from './ResponseStatus'
import { Select } from './Select'

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
 * Labels for the chip. Protocol tokens, so they are not translated — but `binary` is
 * now the *last* resort rather than the answer for every media type the classifier
 * did not recognise, and the chip finally says which of them it is.
 */
const FORMAT_LABEL: Record<ResponseFormat, string> = {
  json: 'JSON',
  ndjson: 'NDJSON',
  xml: 'XML',
  html: 'HTML',
  svg: 'SVG',
  csv: 'CSV',
  markdown: 'MD',
  yaml: 'YAML',
  javascript: 'JS',
  css: 'CSS',
  sse: 'SSE',
  text: 'TEXT',
  image: 'IMAGE',
  audio: 'AUDIO',
  video: 'VIDEO',
  pdf: 'PDF',
  font: 'FONT',
  archive: 'ZIP',
  binary: 'BINARY',
}

/**
 * Opens CodeMirror's own search panel, by giving the editor focus and replaying the
 * keystroke its keymap is already listening for.
 *
 * A `dispatch` of the `openSearchPanel` command would be tidier and needs an
 * `EditorView` handle, which means either a ref threaded through `TextBody` or
 * `@codemirror/search` as a declared dependency for the one import. Neither is worth it
 * for a button whose entire job is to reveal a shortcut the user could already type.
 */
function focusBodySearch(): void {
  const editor = document.querySelector<HTMLElement>('#response-content .cm-content')
  if (!editor) return
  editor.focus()
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, metaKey: true, bubbles: true }))
}

/**
 * One glyph per family rather than per format: the label already carries the exact
 * name, and nineteen distinguishable 13px icons is not a thing that exists.
 */
const FORMAT_ICON: Record<ResponseFormat, typeof Braces> = {
  json: Braces,
  ndjson: Braces,
  xml: Code,
  html: Code,
  svg: Shapes,
  csv: Table,
  markdown: FileText,
  yaml: FileText,
  javascript: Code,
  css: Code,
  sse: Radio,
  text: FileText,
  image: Image,
  audio: FileAudio,
  video: FileVideo,
  pdf: FileType,
  font: Type,
  archive: FileArchive,
  binary: Binary,
}

/**
 * Was a hardcoded "JSON" label that lied about every HTML page and PNG the client
 * fetched. The exact media type is one hover away rather than in the chip, because
 * `application/json; charset=utf-8` does not fit and `JSON` is what you scan for.
 */
function FormatChip({ format, contentType }: { format: ResponseFormat; contentType: string }) {
  const Icon = FORMAT_ICON[format]
  return (
    <div className="response-format" role="presentation" title={contentType || undefined}>
      <Icon size={13} aria-hidden="true" />
      {FORMAT_LABEL[format]}
    </div>
  )
}

/**
 * Takes the chip's place while the body panel is showing something an editor can
 * render. Both say what the body is; only one of them can also change it, and the
 * tabs row is too narrow in the columns layout to carry the pair.
 *
 * The picker sits on the resolved language, so the format stays readable at a glance —
 * that was the chip's whole job — and the media type the server actually sent survives
 * as the title, where the chip kept it too.
 *
 * `frozen` greys the whole group out without removing it. That happens while the hex
 * view is on: it overrides the rendering entirely, so re-indenting or reinterpreting the
 * body would change nothing on screen. This used to unmount the group instead, which
 * meant pressing one button made five others vanish.
 */
function BodyControls({
  mode,
  language,
  contentType,
  frozen,
  onChange,
}: {
  mode: BodyMode
  language: BodyLanguage
  contentType: string
  frozen: boolean
  onChange: (patch: Partial<BodyView>) => void
}) {
  const { t } = useT()
  const onSegmentKeyDown = useRovingFocus('[role="radio"]')

  // Both segments stay visible and go disabled rather than disappearing: a control that
  // comes and goes with the Content-Type reads as a bug. `rich` is unavailable for a
  // format with no viewer of its own, and `pretty` for one nothing can re-indent.
  const enabled: Record<BodyMode, boolean> = {
    rich: !frozen && hasRichView(language),
    pretty: !frozen && canFormat(language),
    raw: !frozen,
  }
  const label: Record<BodyMode, string> = {
    rich: richLabel(t, language),
    pretty: t('response.mode.pretty'),
    raw: t('response.mode.raw'),
  }

  return (
    <div className="body-controls">
      {/* A radiogroup rather than a tablist, like the request body's type picker: these
          pick how one panel renders, they do not switch between panels. */}
      <div className="segmented" role="radiogroup" aria-label={t('response.formatting')} onKeyDown={onSegmentKeyDown}>
        {BODY_MODES.map(option => (
          <button
            type="button"
            key={option}
            role="radio"
            aria-checked={mode === option}
            disabled={!enabled[option]}
            tabIndex={mode === option ? 0 : -1}
            className={mode === option ? 'active' : ''}
            title={enabled[option] ? undefined : t(`response.mode.${option}.unavailable`)}
            onClick={() => onChange({ mode: option })}
          >
            {label[option]}
          </button>
        ))}
      </div>
      {/* Shows the resolved language, so a request nobody has configured still names
          what its body actually is — and picking one pins it from then on. There is no
          entry for "nothing chosen": the default lives in Settings, and this control is
          only for overriding it. */}
      {/* The `find` that used to sit in `onChange` is gone: `Select` is generic over the
          option list, so `language` arrives already narrowed to a `BodyLanguage` and
          there is still nothing to assert. */}
      <Select
        variant="inline"
        ariaLabel={t('response.interpretAs')}
        title={contentType || undefined}
        value={language}
        disabled={frozen}
        options={BODY_LANGUAGES.map(option => ({ value: option, label: bodyLanguageLabel(t, option) }))}
        onChange={next => onChange({ language: next })}
      />
    </div>
  )
}

export function ResponseViewer() {
  const { t, plural } = useT()
  const locale = useLocale()
  const activeId = useAppStore(s => s.activeId)
  const responsePanel = useAppStore(s => s.responsePanel)
  const setResponsePanel = useAppStore(s => s.setResponsePanel)
  const setResponse = useAppStore(s => s.setResponse)
  const stored = useAppStore(s => (s.activeId ? s.responses[s.activeId] : undefined))
  const storedView = useAppStore(s => (s.activeId ? s.bodyViews[s.activeId] : undefined))
  const setBodyView = useAppStore(s => s.setBodyView)
  const defaultBodyLanguage = useAppStore(s => s.defaultBodyLanguage)
  const response = stored ?? { state: 'idle' as const }
  const elapsed = useElapsed(response.state === 'loading' ? response.startedAt : null)
  const { status: copyStatus, copy } = useCopy()
  const onTabsKeyDown = useRovingFocus('[role="tab"]')
  // Which request the hex escape hatch is open for, rather than a bare boolean: the
  // viewer does not remount when tabs change, so a boolean would leak the choice from
  // one request onto the next. Storing the id makes switching away close it, and
  // switching back is a fresh decision — which is right, since it is a way of looking
  // at *this* payload, not a preference.
  const [hexFor, setHexFor] = useState<string | null>(null)
  const hex = hexFor !== null && hexFor === activeId
  // A view preference rather than a per-request one, like the theme: whether long lines
  // wrap is about the width of the panel you are looking at, not about the endpoint.
  const [wrap, setWrap] = useState(true)

  // Hooks cannot sit inside the success branch, so the inputs are read defensively and
  // the memo runs against an empty body the rest of the time — which costs nothing.
  const view = storedView ?? DEFAULT_BODY_VIEW
  const rawBody = response.state === 'success' ? response.body : ''
  const language = resolveLanguage(view, response.state === 'success' ? response.format : 'text', defaultBodyLanguage, rawBody)
  const mode = resolveMode(view, language)
  // Reparsing several MB of JSON on every render — and this component re-renders ten
  // times a second while a *later* request is in flight — is not affordable.
  const { text: bodyText, failed: formatFailed } = useMemo(() => formatBody(rawBody, language, mode), [rawBody, language, mode])
  // Hoisted above the JSX rather than resolved inline, so the error branch stays a
  // plain expression and no hook sits inside a conditional.
  const failure = response.state === 'error' ? errorCopy(t, response.code, response.detail) : null

  // A body-language picker over a payload that never crossed the binding has nothing to
  // interpret, and the pretty/raw toggle nothing to re-indent — so a byte-backed response
  // shows the format chip instead of the group. That swap follows the *response*, not a
  // button: pressing something in this toolbar never changes which controls exist.
  //
  // Everything below is a `disabled` flag rather than a render condition, which is the
  // rule the mode segments already followed and the rest of the row did not. Toggling hex
  // used to unmount the whole control group, and switching to a rich view unmounted find
  // and wrap — so pressing one button made others vanish, and the ones that survived slid
  // sideways into the gap.
  const byteBacked = response.state === 'success' && isByteFormat(response.format)
  const textual = response.state === 'success' && !byteBacked && response.body !== ''
  const hasPayload = response.state === 'success' && (response.body !== '' || response.bodyUrl !== '')
  // Find and wrap act on the CodeMirror instance, so they mean something only when one is
  // actually on screen: not under the hex dump, and not under a tree, table or preview.
  const editorShowing = textual && !hex && mode !== 'rich'

  return (
    <section className="response-viewer" aria-label={t('response.region')}>
      <ResponseStatus response={response} elapsed={elapsed}>
        {response.state === 'success' && (
          <button
            type="button"
            className="icon-btn xs"
            /* Disabled rather than absent for a byte-backed body, which has no text to
               put on the clipboard. The status bar keeps a constant shape for the same
               reason it renders in all four states. */
            disabled={!textual}
            aria-label={copyStatus === 'copied' ? t('response.copiedBody.aria') : t('response.copyBody.aria')}
            title={textual ? (copyStatus === 'copied' ? t('response.copied.title') : t('response.copyBody.title')) : t('response.copyBody.unavailable')}
            /* What is on screen, not what arrived: pasting the indented body is the
               point of having indented it. */
            onClick={() => copy(bodyText)}
          >
            {copyStatus === 'copied' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          </button>
        )}
        {(response.state === 'success' || response.state === 'error') && activeId && (
          <button
            type="button"
            className="icon-btn xs"
            aria-label={t('response.clear.aria')}
            title={t('response.clear.title')}
            onClick={() => setResponse(activeId, { state: 'idle' })}
          >
            <X size={13} aria-hidden="true" />
          </button>
        )}
      </ResponseStatus>

      {/* One region for both copy buttons. The clipboard write used to be a bare `void`
          call: nothing moved on screen, nothing was announced, and a rejected promise —
          a denied clipboard permission — was indistinguishable from success. */}
      <p className="sr-only" role="status" aria-live="polite">
        {copyStatus === 'copied' ? t('response.copied.live') : copyStatus === 'failed' ? t('response.copyFailed.live') : ''}
      </p>

      {response.state === 'idle' && (
        <Placeholder icon={<FileJson2 size={22} />} title={t('response.idle.title')} description={t('response.idle.desc')}>
          <PlaceholderAction shortcut={shortcuts.send} onClick={() => activeId && void runRequest(activeId)}>
            <Send size={13} aria-hidden="true" /> {t('response.idle.send')}
          </PlaceholderAction>
        </Placeholder>
      )}

      {response.state === 'loading' && (
        <div className="response-loading" aria-busy="true">
          <SkeletonLines count={9} />
          <p className="loading-note">{t('response.loading.note', { elapsed: formatDuration(elapsed, locale) })}</p>
          <PlaceholderAction variant="secondary" shortcut={shortcuts.cancel} onClick={() => activeId && cancelRequest(activeId)}>
            {t('response.loading.cancel')}
          </PlaceholderAction>
        </div>
      )}

      {response.state === 'error' && failure && (
        <Placeholder tone="danger" icon={<TriangleAlert size={20} />} title={failure.title} description={failure.detail}>
          <PlaceholderAction shortcut={shortcuts.send} onClick={() => activeId && void runRequest(activeId)}>
            <RotateCcw size={13} aria-hidden="true" /> {t('response.error.retry')}
          </PlaceholderAction>
          {response.code === 'INVALID_URL' && (
            <PlaceholderAction variant="secondary" onClick={() => document.getElementById('request-url')?.focus()}>
              {t('response.error.fixUrl')}
            </PlaceholderAction>
          )}
          <PlaceholderAction variant="secondary" onClick={() => copy(`${response.code}: ${failure.detail}`)}>
            {copyStatus === 'copied' ? t('response.error.copied') : t('response.error.copyDetails')}
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
            <div className="response-tablist" role="tablist" aria-label={t('response.sections')} onKeyDown={onTabsKeyDown}>
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
                {t('response.tab.body')}
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
                {t('response.tab.headers')} <span aria-hidden="true">{response.headers.length}</span>
                <span className="sr-only">{plural('response.tab.returned', response.headers.length)}</span>
              </button>
            </div>
            {responsePanel === 'body' && (
              <div className="body-toolbar">
                {textual ? (
                  <BodyControls
                    mode={mode}
                    language={language}
                    contentType={response.contentType}
                    frozen={hex}
                    onChange={patch => activeId && setBodyView(activeId, patch)}
                  />
                ) : (
                  <FormatChip format={response.format} contentType={response.contentType} />
                )}
                {/* CodeMirror's search panel has always been reachable with Ctrl+F —
                    `basicSetup` leaves its keymap on — and nothing anywhere said so. A
                    feature nobody can find is not a feature. */}
                <button
                  type="button"
                  className="icon-btn xs"
                  disabled={!editorShowing}
                  aria-label={t('response.find.aria')}
                  title={editorShowing ? t('response.find.title') : t('response.find.unavailable')}
                  onClick={focusBodySearch}
                >
                  <Search size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={wrap && editorShowing ? 'icon-btn xs active' : 'icon-btn xs'}
                  disabled={!editorShowing}
                  aria-pressed={wrap}
                  aria-label={t('response.wrap.aria')}
                  title={editorShowing ? t('response.wrap.title') : t('response.wrap.unavailable')}
                  onClick={() => setWrap(current => !current)}
                >
                  <WrapText size={13} aria-hidden="true" />
                </button>
                {/* Offered for every payload, not just the ones nothing else can show:
                    "what are the first sixteen bytes" is a fair question of a JSON body
                    that will not parse, and of a PNG that renders as nothing. */}
                <button
                  type="button"
                  className={hex ? 'icon-btn xs active' : 'icon-btn xs'}
                  disabled={!hasPayload}
                  aria-pressed={hex}
                  aria-label={t('response.hex.toggle.aria')}
                  title={hasPayload ? t('response.hex.toggle.title') : t('response.hex.toggle.unavailable')}
                  onClick={() => setHexFor(hex ? null : activeId)}
                >
                  <Binary size={13} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
          <div className="response-content" id="response-content" role="tabpanel" aria-labelledby={`response-tab-${responsePanel}`} tabIndex={-1}>
            {responsePanel === 'body' ? (
              <BodyPanel response={response} language={language} mode={mode} text={bodyText} formatFailed={formatFailed} hex={hex} wrap={wrap} />
            ) : (
              /* A real table, not a grid of divs with <b> for column heads. Name/value
                 pairs are tabular data, and a screen reader can only navigate them
                 column-by-column if the markup says so. */
              <table className="response-headers">
                <caption className="sr-only">{t('response.headers.caption')}</caption>
                <thead>
                  <tr>
                    {/* Sentence case here too; `.response-headers th` uppercases. */}
                    <th scope="col">{t('response.headers.name')}</th>
                    <th scope="col">{t('response.headers.value')}</th>
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
