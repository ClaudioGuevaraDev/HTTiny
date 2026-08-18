import { FileUp, Trash2 } from 'lucide-react'
import { useAttachments } from '../../attachments'
import { useT } from '../../language'
import { useAppStore } from '../../store'
import type { RequestDocument } from '../../types'
import { Placeholder } from '../Placeholder'
import { FileChip } from './FileChip'

/**
 * The `binary` body: one file sent as the entire payload, with no multipart wrapper.
 *
 * The Content-Type field is here and not in the headers grid because for this body type
 * it is the *only* description of what is being sent — there is no part header and no
 * form field name — and because leaving it empty has a defined meaning: Go derives it
 * from the extension. A hand-typed `Content-Type` header still wins over both, which is
 * the precedence `applyContentType` applies to every body type.
 */
export function BinaryBody({ request }: { request: RequestDocument }) {
  const { t } = useT()
  const setBody = useAppStore(s => s.setBody)
  const file = request.body.file
  const attachments = useAttachments(file.path ? [file.path] : [])

  // Two different layouts, not one with a hole in it. With a file there is a form to
  // lay out, so the panel is the padded, width-capped grid the Auth editor uses; with
  // none there is only the placeholder, which centres itself in whatever fills the
  // panel — and cannot, inside a grid track capped at 610px.
  return (
    <div className={file.path ? 'binary-body' : 'binary-body empty'}>
      {file.path ? (
        <>
          <div className="binary-row">
            <FileChip path={file.path} attachment={attachments[file.path]} onPick={path => setBody(request.id, { file: { ...file, path } })} />
            <button
              type="button"
              className="icon-btn xs"
              aria-label={t('editor.body.file.remove')}
              title={t('editor.body.file.remove')}
              onClick={() => setBody(request.id, { file: { path: '', contentType: '' } })}
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          </div>
          <label className="binary-type">
            {t('editor.body.binary.contentType')}
            <input
              className="technical-input"
              value={file.contentType}
              name="binary-content-type"
              placeholder={t('editor.body.form.contentTypeAuto')}
              autoComplete="off"
              spellCheck={false}
              onChange={e => setBody(request.id, { file: { ...file, contentType: e.target.value } })}
            />
          </label>
        </>
      ) : (
        <Placeholder icon={<FileUp size={20} />} title={t('editor.body.binary.emptyTitle')} description={t('editor.body.binary.emptyDesc')}>
          {/* The chip is the chooser in its empty state, so the placeholder does not
              need a button of its own — one control, in both places it appears. */}
          <FileChip path="" attachment={undefined} onPick={path => setBody(request.id, { file: { ...file, path } })} />
        </Placeholder>
      )}
    </div>
  )
}
