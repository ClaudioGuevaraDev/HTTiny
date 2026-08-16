import { useCallback, useMemo, useRef, useState } from 'react'
import type { CSSProperties, UIEvent } from 'react'
import { Binary, TriangleAlert } from 'lucide-react'
import { formatBytes } from '../../format'
import { useLocale, useT } from '../../language'
import { BYTES_PER_ROW, encodeText, hexRow, offsetLabel, rowCount } from '../../response/hex'
import { useResponseBytes } from '../../response/bytes'
import { isByteFormat } from '../../types'
import type { SuccessResponse } from '../../types'
import { Placeholder, SkeletonLines } from '../Placeholder'

/**
 * Row geometry lives here rather than in the stylesheet because the windowing maths
 * depends on it. It is published to CSS as a custom property, so the two cannot drift:
 * JS is the source of truth and the rule reads it back.
 */
const ROW_HEIGHT = 18
/** Rows rendered beyond the viewport, so a fast scroll does not reveal blank space. */
const OVERSCAN = 8

/**
 * A hex dump of the response, for everything no other viewer claims.
 *
 * This is the format coverage's floor. Before it, an unrecognised media type produced
 * a grey card reading "Binary response" and nothing else — true, and useless for
 * telling a corrupt gzip from a protobuf from an HTML error page mislabelled as
 * octet-stream. The first sixteen bytes usually answer that.
 *
 * Only the visible rows are built. A 30 MB payload is two million rows, and both the
 * string concatenation and the DOM for that are out of the question; `hexRow` exists
 * to be called one row at a time.
 */
export function HexBody({ response }: { response: SuccessResponse }) {
  const { t } = useT()
  const locale = useLocale()
  const [viewportRows, setViewportRows] = useState(40)
  const [firstVisible, setFirstVisible] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)

  // A textual body already crossed the binding, so its bytes are re-encoded locally
  // rather than fetched again. Passing an empty URL keeps the hook unconditional.
  const byteBacked = isByteFormat(response.format)
  const remote = useResponseBytes(byteBacked ? response.bodyUrl : '')
  const local = useMemo(() => (byteBacked ? null : encodeText(response.body)), [byteBacked, response.body])
  const bytes = byteBacked ? remote.bytes : local

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget
    setFirstVisible(Math.floor(element.scrollTop / ROW_HEIGHT))
    setViewportRows(Math.ceil(element.clientHeight / ROW_HEIGHT))
  }, [])

  if (remote.loading) return <SkeletonLines count={12} />
  if (remote.failed || !bytes) {
    return (
      <Placeholder
        tone="danger"
        icon={<TriangleAlert size={20} />}
        title={t('response.bytes.gone.title')}
        description={t('response.bytes.gone.desc')}
      />
    )
  }
  if (bytes.length === 0) {
    return <Placeholder icon={<Binary size={20} />} title={t('response.emptyBody.title')} description={t('response.emptyBody.desc')} />
  }

  const total = rowCount(bytes.length)
  const start = Math.max(0, firstVisible - OVERSCAN)
  const end = Math.min(total, firstVisible + viewportRows + OVERSCAN)
  const rows = Array.from({ length: end - start }, (_, i) => hexRow(bytes, start + i))

  return (
    <div className="hex-viewer" style={{ '--hex-row-height': `${ROW_HEIGHT}px` } as CSSProperties}>
      <p className="hex-summary">
        {t('response.hex.summary', { size: formatBytes(bytes.length, locale), rows: total })}
      </p>
      {/* The scroller owns a spacer of the full height and a slab of rows translated
          into place. A table would be the honest markup for three aligned columns, but
          a table cannot be windowed without lying to the browser about its own row
          count, so this is a grid with an explicit row/column reading order instead. */}
      <div className="hex-scroller" ref={scroller} onScroll={onScroll} tabIndex={0} role="group" aria-label={t('response.hex.aria')}>
        <div className="hex-spacer" style={{ height: `${total * ROW_HEIGHT}px` }}>
          <div className="hex-rows" style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
            {rows.map(row => (
              <div className="hex-row" key={row.offset}>
                <span className="hex-offset">{offsetLabel(row.offset)}</span>
                <span className="hex-cells">
                  {row.cells.map((cell, index) => (
                    <span
                      key={index}
                      className="hex-cell"
                      // The eight-byte gutter is what makes a column countable without
                      // reading the offset. Zero bytes are dimmed: a run of them is the
                      // single most recognisable shape in a dump.
                      data-gap={index === BYTES_PER_ROW / 2 ? 'true' : undefined}
                      data-zero={cell === '00' ? 'true' : undefined}
                    >
                      {cell}
                    </span>
                  ))}
                </span>
                <span className="hex-ascii">{row.ascii}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
