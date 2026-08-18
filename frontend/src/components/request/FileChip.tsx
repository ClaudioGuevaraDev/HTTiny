import { FileWarning, Paperclip } from 'lucide-react'
import { PICK_TITLE, basename, pickFiles, type Attachment } from '../../attachments'
import { formatBytes } from '../../format'
import { useLocale, useT } from '../../language'

/**
 * One chosen file, as a button that re-opens the chooser.
 *
 * The whole chip is the control rather than a label with a "Change" button beside it:
 * there is one thing to do to an attachment that is not "remove it", and a row in a
 * compact grid has no width for two controls saying so.
 *
 * `attachment` is undefined until `useAttachments` answers, and undefined is not the
 * same as missing — a chip that flashed "file not found" on every render before the
 * stat came back would be crying wolf. So the name falls back to the path's own last
 * segment, the size is simply absent, and only an explicit `exists: false` is drawn as
 * a problem.
 */
export function FileChip({ path, attachment, onPick }: { path: string; attachment: Attachment | undefined; onPick: (path: string) => void }) {
  const { t } = useT()
  const locale = useLocale()

  const choose = () => {
    void pickFiles(t(PICK_TITLE.one), false).then(paths => {
      const [chosen] = paths
      if (chosen) onPick(chosen)
    })
  }

  if (!path) {
    return (
      <button type="button" className="file-chip empty" onClick={choose}>
        <Paperclip size={12} aria-hidden="true" />
        {t('editor.body.file.choose')}
      </button>
    )
  }

  const missing = attachment?.exists === false
  return (
    <button
      type="button"
      className={`file-chip ${missing ? 'missing' : ''}`}
      onClick={choose}
      // The path is the tooltip because the chip shows only the last segment, and
      // "which of the three logo.png" is the question a bare filename cannot answer.
      title={missing ? `${path}\n${t('editor.body.file.missingHint')}` : path}
    >
      {missing ? <FileWarning size={12} aria-hidden="true" /> : <Paperclip size={12} aria-hidden="true" />}
      <span className="file-chip-name">{attachment?.name || basename(path)}</span>
      <span className="file-chip-meta">{missing ? t('editor.body.file.missing') : attachment ? formatBytes(attachment.size, locale) : ''}</span>
    </button>
  )
}
