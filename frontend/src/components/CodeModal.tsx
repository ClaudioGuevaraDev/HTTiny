import { useEffect, useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { Check, Code2, Copy, X } from 'lucide-react'
import { httinyTheme } from '../editorTheme'
import { errorCopy } from '../errors'
import { formatBytes } from '../format'
import { useLocale, useT } from '../language'
import { SNIPPET_TARGETS, snippetFor, targetFor, type Wire } from '../snippets'
import { extensionsFor } from '../snippets/highlight'
import { useAppStore } from '../store'
import { useCopy } from '../useCopy'
import { useWire } from '../useWire'
import { Placeholder } from './Placeholder'
import { Select } from './Select'

/**
 * The code view: what the app is about to send, and how to say the same thing elsewhere.
 *
 * Same shell as `SettingsModal` and the command palette, for the same four reasons —
 * `<dialog>` with `showModal()` supplies a real focus trap, top-layer rendering, focus
 * restoration on close and native Escape. The body only mounts while open, which is what
 * keeps `useWire` from resolving requests nobody is looking at, and closing always goes
 * through `dialog.close()` so the DOM and the store cannot desync.
 */
export function CodeModal() {
  const open = useAppStore(s => s.codeOpen)
  const closeCode = useAppStore(s => s.closeCode)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="code-dialog"
      aria-modal="true"
      aria-labelledby="code-title"
      onClose={closeCode}
      onClick={event => {
        if (event.target === dialogRef.current) dialogRef.current?.close()
      }}
    >
      {open && <CodeBody onDismiss={() => dialogRef.current?.close()} />}
    </dialog>
  )
}

function CodeBody({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useT()
  const request = useAppStore(s => (s.activeId ? s.documents[s.activeId] : undefined))
  const target = useAppStore(s => s.codeTarget)
  const setCodeTarget = useAppStore(s => s.setCodeTarget)
  const redact = useAppStore(s => s.redactSecrets)
  const setRedactSecrets = useAppStore(s => s.setRedactSecrets)
  const { status: copyStatus, copy } = useCopy()
  const wire = useWire(request)

  // Regenerating is cheap, but it happens on every keystroke in the URL bar *and* on every
  // unrelated store update the modal subscribes to. Memoising keeps CodeMirror from being
  // handed a new document when nothing about the request changed.
  const code = useMemo(() => (wire.state === 'ready' ? snippetFor(target, wire.wire, redact) : ''), [wire, target, redact])
  const mode = targetFor(target).mode

  return (
    <div className="code-shell">
      <div className="code-toolbar">
        <h2 id="code-title" className="code-title">
          <Code2 size={14} aria-hidden="true" />
          {t('code.title')}
        </h2>
        <Select
          variant="inline"
          ariaLabel={t('code.target')}
          title={t('code.target')}
          value={target}
          options={SNIPPET_TARGETS.map(entry => ({ value: entry.id, label: entry.label }))}
          onChange={setCodeTarget}
        />
        {/* A switch rather than a checkbox, and the same construction as the settings rows:
            a `<button role="switch">` carrying an `.on` class. */}
        <button
          type="button"
          className={`code-redact ${redact ? 'on' : ''}`}
          role="switch"
          aria-checked={redact}
          title={t('code.redact.desc')}
          onClick={() => setRedactSecrets(!redact)}
        >
          {t('code.redact.label')}
        </button>
        <button
          type="button"
          className="icon-btn xs"
          disabled={!code}
          aria-label={copyStatus === 'copied' ? t('code.copied.aria') : t('code.copy.aria')}
          title={t('code.copy.title')}
          onClick={() => copy(code)}
        >
          {copyStatus === 'copied' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        </button>
        <button type="button" className="icon-btn code-close" aria-label={t('code.close')} onClick={onDismiss}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      {/* The clipboard write is acknowledged out loud for the reason `ResponseViewer`
          spells out: a denied permission is otherwise indistinguishable from success. */}
      <p className="sr-only" role="status" aria-live="polite">
        {copyStatus === 'copied' ? t('code.copied.live') : copyStatus === 'failed' ? t('code.copyFailed.live') : ''}
      </p>

      <div className="code-body">
        {wire.state === 'ready' ? (
          <CodeMirror
            value={code}
            theme={httinyTheme}
            extensions={extensionsFor(mode)}
            editable={false}
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, searchKeymap: false }}
          />
        ) : (
          <WireProblem
            state={wire.state}
            code={wire.state === 'failed' ? wire.code : 'BACKEND_UNAVAILABLE'}
            detail={wire.state === 'failed' ? wire.detail : ''}
          />
        )}
      </div>

      {wire.state === 'ready' && <Policy wire={wire.wire} />}
    </div>
  )
}

/**
 * Why there is no snippet. Both cases resolve their copy from a code through
 * `errorCopy`, so an invalid URL reads the same here as it does in the response pane —
 * and retranslates with the language, rather than being frozen at render time.
 */
function WireProblem({ state, code, detail }: { state: 'loading' | 'failed' | 'unavailable'; code: string; detail: string }) {
  const { t } = useT()
  if (state === 'loading') return null
  const copy = errorCopy(t, code, detail)
  return <Placeholder icon={<Code2 size={20} />} title={copy.title} description={copy.detail} />
}

/**
 * What the client does that no request line shows.
 *
 * Every figure is read out of `WirePolicy` — Go's own constants — rather than written
 * here, so this cannot come to disagree with the client that enforces it. It stays on
 * screen for every target because it is the part no snippet expresses: a generated `curl`
 * carries the timeout and the redirect cap, but nothing carries "responses stop being
 * read at 32 MiB".
 */
function Policy({ wire }: { wire: Wire }) {
  const { t } = useT()
  const locale = useLocale()
  const policy = wire.policy
  // Not `source !== 'request'` on its own: the Host row `snippetHeaders` synthesises is
  // also marked `request`, and it is genuinely the user's.
  const added = wire.headers.filter(header => header.source !== 'request').map(header => header.key)

  return (
    <div className="code-policy">
      <p>
        {[
          t('code.policy.timeout', { seconds: Math.round(policy.timeoutMs / 1000) }),
          t('code.policy.redirects', { limit: policy.maxRedirects }),
          ...(policy.gzip ? [t('code.policy.gzip')] : []),
          ...(policy.http2 ? [t('code.policy.http2')] : []),
          ...(policy.verifyTls ? [t('code.policy.tls')] : []),
          t('code.policy.cap', { size: formatBytes(policy.maxBodyBytes, locale) }),
        ].join(' · ')}
      </p>
      {added.length > 0 && <p className="code-policy-added">{t('code.policy.added', { headers: added.join(', ') })}</p>}
    </div>
  )
}
