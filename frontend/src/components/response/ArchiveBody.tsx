import { FileArchive, Folder } from 'lucide-react'
import { formatBytes } from '../../format'
import { useLocale, useT } from '../../language'
import type { SuccessResponse } from '../../types'
import { HexBody } from './HexBody'

/**
 * The contents of a zip response.
 *
 * Read in Go from the archive's central directory while the bytes were already in hand
 * — see `internal/httpexec/archive.go`. gzip and tar classify as archives too and have
 * no index to read: a gzip stream would have to be decompressed in full to say what is
 * in it, and a tar has no directory at all, only a walk. Both fall through to the hex
 * viewer, which is what every archive had before this existed.
 */
export function ArchiveBody({ response }: { response: SuccessResponse }) {
  const { t, plural } = useT()
  const locale = useLocale()
  const entries = response.archive

  if (entries.length === 0) return <HexBody response={response} />

  const files = entries.filter(entry => !entry.directory)
  const uncompressed = files.reduce((total, entry) => total + entry.size, 0)

  return (
    <div className="archive-body">
      <div className="media-toolbar">
        <p className="media-facts">
          <span>{plural('response.archive.entries', files.length)}</span>
          {/* The pair is the interesting number: it is the whole reason the thing is
              an archive rather than a directory. */}
          <span>{t('response.archive.sizes', { packed: formatBytes(response.sizeBytes, locale), unpacked: formatBytes(uncompressed, locale) })}</span>
        </p>
      </div>
      <div className="archive-scroller">
        <table className="archive-grid">
          <caption className="sr-only">{t('response.archive.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('response.archive.name')}</th>
              <th scope="col">{t('response.archive.size')}</th>
              <th scope="col">{t('response.archive.packed')}</th>
              <th scope="col">{t('response.archive.modified')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              <tr key={entry.name}>
                <th scope="row" className="archive-name">
                  {entry.directory ? <Folder size={12} aria-hidden="true" /> : <FileArchive size={12} aria-hidden="true" />}
                  <code>{entry.name}</code>
                </th>
                {/* A directory entry has no content of its own; showing 0 B twice would
                    read as a fact rather than as an absence. */}
                <td>{entry.directory ? '—' : formatBytes(entry.size, locale)}</td>
                <td>{entry.directory ? '—' : formatBytes(entry.compressedSize, locale)}</td>
                <td>{entry.modified ? new Date(entry.modified).toLocaleString(locale) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
