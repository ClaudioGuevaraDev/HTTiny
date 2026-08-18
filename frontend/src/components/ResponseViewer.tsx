import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Binary,
  Braces,
  Check,
  Code,
  Copy,
  Download,
  FileArchive,
  FileAudio,
  FileJson2,
  FileText,
  FileType,
  FileVideo,
  Image,
  Radio,
  RotateCcw,
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
import { parseCookies } from '../response/cookies'
import { buildPattern, findMatches, segments, stepMatch } from '../response/search'
import { isByteFormat } from '../types'
import type { BodyLanguage, BodyMode, BodyView, KeyValueRow, ResponseFormat, ResponsePanel } from '../types'
import { cancelRequest, runRequest, saveResponseBody } from '../requestRunner'
import { shortcuts } from '../shortcuts'
import { DEFAULT_RESPONSE_PANEL, useAppStore } from '../store'
import { useCopy } from '../useCopy'
import { useSave } from '../useSave'
import { useRovingFocus } from '../useRovingFocus'
import { BodyPanel } from './response/BodyPanel'
import { CookiesPanel } from './response/CookiesPanel'
import { RedirectChain } from './response/RedirectChain'
import { TimelinePanel } from './response/TimelinePanel'
import { ResponseSearchBar } from './response/ResponseSearchBar'
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

/** Module scope, so the "no headers yet" case is one stable reference and not a new []. */
const NO_HEADERS: KeyValueRow[] = []
/** Same, for the panels that have no row-match model of their own. */
const NO_ROWS: number[] = []

/**
 * The panels the find bar can traverse: the ones that are a table of strings. Listed
 * rather than derived from "not the body", so a panel that is neither — Timeline is
 * bars and facts — does not silently claim to be searchable.
 */
const SEARCHABLE_PANELS: ReadonlySet<ResponsePanel> = new Set<ResponsePanel>(['headers', 'cookies'])

/**
 * Renders a cell with the search matches marked.
 *
 * `<mark>` elements built from segments rather than a highlighted HTML string: these
 * are header names and values that came from someone else's server, and building the
 * markup would mean `dangerouslySetInnerHTML` over them — which is exactly what the
 * response viewer's original regex highlighter did, and why it was replaced.
 */
function Highlighted({ text, pattern }: { text: string; pattern: RegExp | null }) {
  if (!pattern) return <code>{text}</code>
  return (
    <code>
      {segments(text, pattern).map((segment, index) => (segment.match ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>))}
    </code>
  )
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
 * Knows nothing about the hex view, deliberately. These controls stay live while it is on
 * and dismiss it when used; that is the caller's business, and it happens inside the
 * `onChange` it already passes. A `frozen` prop used to grey the whole group out here,
 * which left the only way out of the hex view being the button that got you into it.
 */
function BodyControls({
  mode,
  language,
  contentType,
  onChange,
}: {
  mode: BodyMode
  language: BodyLanguage
  contentType: string
  onChange: (patch: Partial<BodyView>) => void
}) {
  const { t } = useT()
  const onSegmentKeyDown = useRovingFocus('[role="radio"]')

  // Both segments stay visible and go disabled rather than disappearing: a control that
  // comes and goes with the Content-Type reads as a bug. `rich` is unavailable for a
  // format with no viewer of its own, and `pretty` for one nothing can re-indent. Those
  // are the only two reasons left — neither depends on what the panel is showing now.
  const enabled: Record<BodyMode, boolean> = {
    rich: hasRichView(language),
    pretty: canFormat(language),
    raw: true,
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
  // Per request, for the reason the editor's panel is: leaving one response on Headers
  // has no business opening the next one there.
  const responsePanel = useAppStore(s => (s.activeId ? s.responsePanels[s.activeId] : undefined) ?? DEFAULT_RESPONSE_PANEL)
  const setResponsePanel = useAppStore(s => s.setResponsePanel)
  const setResponse = useAppStore(s => s.setResponse)
  const stored = useAppStore(s => (s.activeId ? s.responses[s.activeId] : undefined))
  const storedView = useAppStore(s => (s.activeId ? s.bodyViews[s.activeId] : undefined))
  const setBodyView = useAppStore(s => s.setBodyView)
  const defaultBodyLanguage = useAppStore(s => s.defaultBodyLanguage)
  const search = useAppStore(s => s.responseSearch)
  const response = stored ?? { state: 'idle' as const }
  const elapsed = useElapsed(response.state === 'loading' ? response.startedAt : null)
  const { status: copyStatus, copy } = useCopy()
  const { status: saveStatus, save } = useSave()
  const onTabsKeyDown = useRovingFocus('[role="tab"]')
  // Which request the hex escape hatch is open for, rather than a bare boolean: the
  // viewer does not remount when tabs change, so a boolean would leak the choice from
  // one request onto the next. Storing the id makes switching away close it, and
  // switching back is a fresh decision — which is right, since it is a way of looking
  // at *this* payload, not a preference.
  const [hexFor, setHexFor] = useState<string | null>(null)
  const hex = hexFor !== null && hexFor === activeId

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
  // `response` is `stored ?? {state:'idle'}`, a fresh object on every render, so a memo
  // that depended on it would recompute constantly. The headers array off the store
  // snapshot is stable, which is what the header search memo below actually needs.
  const headers = response.state === 'success' ? response.headers : NO_HEADERS
  // When the response landed, not when this happened to render. `Max-Age` is defined as a
  // duration from receipt, so that is the only instant it can be resolved against — and
  // reading the clock here instead would make the expiry drift on every repaint, of which
  // there are ten a second while a *later* request is in flight.
  const receivedAt = response.state === 'success' ? response.receivedAt : 0
  const cookies = useMemo(() => parseCookies(headers, receivedAt), [headers, receivedAt])
  const byteBacked = response.state === 'success' && isByteFormat(response.format)
  const textual = response.state === 'success' && !byteBacked && response.body !== ''
  const hasPayload = response.state === 'success' && (response.body !== '' || response.bodyUrl !== '')
  // *Reachable*, not showing. Find and wrap act on a CodeMirror instance, and pressing
  // either now leaves the hex view to get to one — so the hex view is not a reason to grey
  // them out. A rich view is: there the way back is a labelled segment sitting right
  // beside it, which is exactly what the hex toggle never had.
  const editorReachable = textual && mode !== 'rich'

  // Every body control dismisses the hex view. It is an overlay on the body rather than a
  // mode of it, and it used to be exitable only through the button that opened it, with
  // the whole rest of the row greyed out behind it — a dead end that gave no clue it was
  // one. Each control still does its own job; leaving hex is what makes that job visible.
  const leaveHex = () => setHexFor(null)

  // The saved file is whatever the panel is showing, so the two ways that can differ
  // from what the server sent have to be said *before* writing, not discovered after:
  // a body past the editor's ceiling saves short, and one transcoded from another
  // charset saves as UTF-8. Both facts are already on the response.
  const saveTitle = !hasPayload
    ? t('response.save.unavailable')
    : response.state === 'success' && response.truncated
      ? t('response.save.truncated')
      : response.state === 'success' && response.encoding !== ''
        ? t('response.save.transcoded', { charset: response.encoding })
        : t('response.save.title')

  // ── Search ────────────────────────────────────────────────────────────────────
  //
  // Matches are found here, over strings this component already holds, rather than asked
  // of CodeMirror. That is what lets one bar serve the headers tab, which has no editor
  // at all, and it is why the count is available without a round trip.
  const onBody = responsePanel === 'body'
  // Destructured so the memo's dependencies are the three fields the pattern is built
  // from. Passing `search` whole would rebuild it whenever the bar merely opened.
  const { query, caseSensitive, regexp } = search
  const pattern = useMemo(() => buildPattern(query, { caseSensitive, regexp }), [query, caseSensitive, regexp])
  // Named panels rather than "anything that is not the body". That shorthand held while
  // every other panel was a table of strings, and stopped holding the moment one was not:
  // Timeline would have inherited `!onBody`, promised the find bar it could be traversed,
  // and then reported zero matches forever, because `activeRows` has nothing for it.
  //
  // The body can only be searched when it is the editor showing: the tree, the CSV table,
  // the hex dump and the previews draw from their own models, and two of them render a
  // window of rows rather than the whole document, so "scroll to the match" is a
  // different feature there.
  const searchable = response.state === 'success' && (onBody ? textual && !hex && mode !== 'rich' : SEARCHABLE_PANELS.has(responsePanel))

  const bodyMatches = useMemo(() => (searchable && onBody ? findMatches(bodyText, pattern) : []), [searchable, onBody, bodyText, pattern])

  // One entry per match, holding the row it sits in — that is all stepping needs, since
  // the highlighting is done per cell by `Highlighted` regardless of which is current.
  //
  // Shared by both tables rather than written once per panel. It used to be inline for
  // the headers, keyed off an `onHeaders` boolean that really meant "not the body"; a
  // third panel would have made that boolean wrong in five places at once.
  const rowMatches = (rows: readonly (readonly string[])[]): number[] => {
    if (!pattern) return []
    const out: number[] = []
    rows.forEach((cells, index) => {
      const hits = cells.reduce((sum, cell) => sum + findMatches(cell, pattern).length, 0)
      for (let hit = 0; hit < hits; hit += 1) out.push(index)
    })
    return out
  }

  const headerMatches = useMemo(
    () => (responsePanel === 'headers' ? rowMatches(headers.map(header => [header.key, header.value])) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rowMatches` closes over `pattern`, which is listed.
    [responsePanel, pattern, headers],
  )
  const cookieMatches = useMemo(
    () => (responsePanel === 'cookies' ? rowMatches(cookies.map(cookie => [cookie.name, cookie.value, cookie.domain, cookie.path, cookie.sameSite])) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above.
    [responsePanel, pattern, cookies],
  )

  // The two models stay apart because they are not the same thing: the body's are
  // character offsets into `bodyText`, a table's are row indices. Merging them into one
  // list would typecheck only by widening to a union that neither consumer can index.
  const activeRows = responsePanel === 'headers' ? headerMatches : responsePanel === 'cookies' ? cookieMatches : NO_ROWS
  const total = onBody ? bodyMatches.length : activeRows.length
  const [activeMatch, setActiveMatch] = useState(0)
  // Clamped rather than reset: refining a query usually narrows it, and jumping back to
  // the first hit on every keystroke would undo the stepping just done. The clamp only
  // bites when the list shrank past where the user was.
  const current = total === 0 ? 0 : Math.min(activeMatch, total - 1)
  const step = (delta: number) => setActiveMatch(stepMatch(current, delta, total))

  // One ref for whichever table is showing: they are never mounted at the same time.
  const tableBody = useRef<HTMLTableSectionElement>(null)
  useEffect(() => {
    if (onBody || activeRows.length === 0) return
    tableBody.current?.children[activeRows[current]]?.scrollIntoView({ block: 'nearest' })
  }, [onBody, activeRows, current])

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
        {response.state === 'success' && (
          <button
            type="button"
            className="icon-btn xs"
            /* The one action that works for a payload the clipboard cannot take, so
               it sits beside copy: whichever of the pair is greyed out, the other is
               the way to get this response out of the app. */
            disabled={!hasPayload}
            aria-label={t('response.save.aria')}
            title={saveTitle}
            onClick={() =>
              save(() =>
                saveResponseBody({
                  id: activeId ?? '',
                  // Only read when Go holds no bytes for this id — a textual body,
                  // which is not retained there. `bodyText` rather than
                  // `response.body`, so what lands on disk is what is on screen.
                  text: byteBacked ? '' : bodyText,
                  filename: response.filename,
                  title: t('response.save.dialog'),
                }),
              )
            }
          >
            {saveStatus === 'saved' ? <Check size={13} aria-hidden="true" /> : <Download size={13} aria-hidden="true" />}
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
        {copyStatus === 'copied'
          ? t('response.copied.live')
          : copyStatus === 'failed'
            ? t('response.copyFailed.live')
            : saveStatus === 'saved'
              ? t('response.saved.live')
              : saveStatus === 'failed'
                ? t('response.saveFailed.live')
                : ''}
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
        // Wrapped so a chain can follow the placeholder. The wrapper also takes it out of
        // `.response-content > .placeholder`, which is what let the failure fill the pane;
        // `[data-chain]` puts that back only when there is nothing below it.
        <div className="response-failure" data-chain={response.redirects.length > 0 ? 'true' : undefined}>
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
          {/* The one question a redirect loop asks is *which* URLs it went round, and the
              failure used to report the count and throw the chain away. It is worth as
              much when the fourth hop is the one that timed out. */}
          {response.redirects.length > 0 && (
            <div className="response-failure-chain">
              <RedirectChain
                hops={response.redirects}
                end={response.code === 'TOO_MANY_REDIRECTS' ? { kind: 'notFollowed' } : { kind: 'unreached' }}
                locale={locale}
              />
            </div>
          )}
        </div>
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
                onClick={() => activeId && setResponsePanel(activeId, 'body')}
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
                onClick={() => activeId && setResponsePanel(activeId, 'headers')}
              >
                {t('response.tab.headers')} <span aria-hidden="true">{response.headers.length}</span>
                <span className="sr-only">{plural('response.tab.returned', response.headers.length)}</span>
              </button>
              {/* Always present, with its count, like Headers. A response that set none
                  shows a zero and says so in the panel — a tab that came and went with
                  the response would move the two beside it under the pointer. */}
              <button
                type="button"
                role="tab"
                id="response-tab-cookies"
                aria-selected={responsePanel === 'cookies'}
                aria-controls="response-content"
                tabIndex={responsePanel === 'cookies' ? 0 : -1}
                className={responsePanel === 'cookies' ? 'active' : ''}
                onClick={() => activeId && setResponsePanel(activeId, 'cookies')}
              >
                {t('response.tab.cookies')} <span aria-hidden="true">{cookies.length}</span>
                <span className="sr-only">{plural('response.tab.returned', cookies.length)}</span>
              </button>
              {/* No count badge. Headers and Cookies carry one because they count things;
                  the only number here is the total time, and the status bar above already
                  shows it — repeating it would be the redundant strip Cookies just lost. */}
              <button
                type="button"
                role="tab"
                id="response-tab-timeline"
                aria-selected={responsePanel === 'timeline'}
                aria-controls="response-content"
                tabIndex={responsePanel === 'timeline' ? 0 : -1}
                className={responsePanel === 'timeline' ? 'active' : ''}
                onClick={() => activeId && setResponsePanel(activeId, 'timeline')}
              >
                {t('response.tab.timeline')}
              </button>
            </div>
            {responsePanel === 'body' && (
              <div className="body-toolbar">
                {textual ? (
                  <BodyControls
                    mode={mode}
                    language={language}
                    contentType={response.contentType}
                    onChange={patch => {
                      leaveHex()
                      if (activeId) setBodyView(activeId, patch)
                    }}
                  />
                ) : (
                  <FormatChip format={response.format} contentType={response.contentType} />
                )}
                {/* The magnifying glass that used to sit here is gone. It existed only to
                    reveal CodeMirror's own Ctrl+F, which it did by synthesising a fake
                    keyboard event — and that panel could not reach the headers tab and
                    ignored the theme. `ResponseSearchBar` replaces both, and Ctrl+F now
                    answers from anywhere in the window. */}
                {/* These two are one two-way switch, not two independent toggles: wrapped
                    text and a hex dump are two ways of looking at the same bytes, so
                    exactly one of them is lit and pressing the lit one does nothing.
                    "Neither" was never a state worth reaching — it left the row with no
                    mark on it at all — and "both" read as two views being on at once. */}
                <button
                  type="button"
                  className={hex ? 'icon-btn' : 'icon-btn active'}
                  /* Never dead while the hex view is showing: this is the way back out of
                     it, whatever the payload is. Off in the hex view it would be a dead
                     end for every body CodeMirror does not take — an image, a PDF, a JSON
                     tree — which is the trap the hex toggle itself used to be. */
                  disabled={!editorReachable && !hex}
                  aria-pressed={!hex}
                  aria-label={t('response.wrap.aria')}
                  title={editorReachable || hex ? t('response.wrap.title') : t('response.wrap.unavailable')}
                  /* `leaveHex` alone is the no-op when this is already the one showing:
                     `setHexFor(null)` against a state that is already null, which React
                     bails out of without a render. */
                  onClick={leaveHex}
                >
                  <WrapText size={15} aria-hidden="true" />
                </button>
                {/* Offered for every payload, not just the ones nothing else can show:
                    "what are the first sixteen bytes" is a fair question of a JSON body
                    that will not parse, and of a PNG that renders as nothing. */}
                <button
                  type="button"
                  className={hex ? 'icon-btn active' : 'icon-btn'}
                  disabled={!hasPayload}
                  aria-pressed={hex}
                  aria-label={t('response.hex.toggle.aria')}
                  title={hasPayload ? t('response.hex.toggle.title') : t('response.hex.toggle.unavailable')}
                  /* Also a no-op when it is the one showing: `setHexFor` writes the same id
                     back. Leaving is the other button's job. */
                  onClick={() => setHexFor(activeId)}
                >
                  <Binary size={15} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
          {/* Between the tabs and the panel, so it belongs to whichever tab is showing
              and does not shift the status bar above it. Keyed on the tab so the input
              is refocused when you move between body and headers with it open. */}
          {search.open && (
            <ResponseSearchBar
              key={responsePanel}
              total={total}
              active={current}
              searchable={searchable}
              onStep={step}
              onShowAsText={() => {
                leaveHex()
                if (activeId) setBodyView(activeId, { mode: 'pretty' })
              }}
            />
          )}
          <div className="response-content" id="response-content" role="tabpanel" aria-labelledby={`response-tab-${responsePanel}`} tabIndex={-1}>
            {responsePanel === 'body' ? (
              <BodyPanel
                response={response}
                language={language}
                mode={mode}
                text={bodyText}
                formatFailed={formatFailed}
                hex={hex}
                /* Always: the text view is now one half of a two-way switch rather than a
                   setting with an off position, so there is no unwrapped text view left to
                   ask for. `BodyPanel` still takes the prop — it passes `false` for NDJSON,
                   whose lines are records and are meant to be counted. */
                wrap
                match={search.open && onBody ? (bodyMatches[current] ?? null) : null}
              />
            ) : responsePanel === 'timeline' ? (
              <TimelinePanel timings={response.timings} tls={response.tls} redirects={response.redirects} finalUrl={response.finalUrl} />
            ) : responsePanel === 'cookies' ? (
              <CookiesPanel
                cookies={cookies}
                now={receivedAt}
                currentRow={search.open ? (activeRows[current] ?? -1) : -1}
                bodyRef={tableBody}
                /* The same marking as the headers table, passed rather than reimplemented:
                   two ways of drawing a search hit in one panel is one too many. */
                highlight={text => <Highlighted text={text} pattern={search.open ? pattern : null} />}
              />
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
                <tbody ref={tableBody}>
                  {response.headers.map((h, index) => (
                    /* Marked when a match in this row is the current one, so stepping
                       through a table where several rows match is followable. */
                    <tr key={h.id} data-current={search.open && activeRows[current] === index ? 'true' : undefined}>
                      <td>
                        <Highlighted text={h.key} pattern={search.open ? pattern : null} />
                      </td>
                      <td>
                        <Highlighted text={h.value} pattern={search.open ? pattern : null} />
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
