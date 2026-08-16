import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { useT } from '../../language'
import { useRovingFocus } from '../../useRovingFocus'
import { Placeholder } from '../Placeholder'

const FITS = ['fit', 'actual'] as const
type Fit = (typeof FITS)[number]

/**
 * Renders an image response.
 *
 * This is the whole point of retaining the bytes: `src` is the asset route Go serves
 * them on, so the webview decodes the picture itself, in whatever formats it already
 * supports — WEBP and AVIF included, without this file knowing they exist.
 *
 * The natural dimensions are read off the element rather than decoded in Go. The
 * browser has to parse the header anyway to paint it, and doing it here means one
 * fewer image-format dependency on the Go side for every codec the webview gains.
 */
export function ImageBody({ url, contentType }: { url: string; contentType: string }) {
  const { t } = useT()
  const [fit, setFit] = useState<Fit>('fit')
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [broken, setBroken] = useState(false)
  const onSegmentKeyDown = useRovingFocus('[role="radio"]')

  if (broken) {
    return (
      <Placeholder
        tone="danger"
        icon={<ImageOff size={20} />}
        title={t('response.image.broken.title')}
        description={t('response.image.broken.desc')}
      />
    )
  }

  return (
    <div className="media-body">
      <div className="media-toolbar">
        <div className="segmented" role="radiogroup" aria-label={t('response.image.zoom')} onKeyDown={onSegmentKeyDown}>
          {FITS.map(option => (
            <button
              type="button"
              key={option}
              role="radio"
              aria-checked={fit === option}
              tabIndex={fit === option ? 0 : -1}
              className={fit === option ? 'active' : ''}
              onClick={() => setFit(option)}
            >
              {option === 'fit' ? t('response.image.fit') : t('response.image.actual')}
            </button>
          ))}
        </div>
        {/* Dimensions and media type are the two things a hover tooltip on a chip used
            to hide. They are the reason someone opens an image response at all. */}
        <p className="media-facts">
          {size && <span className="media-dimensions">{t('response.image.dimensions', { width: size.width, height: size.height })}</span>}
          {contentType && <span className="media-type">{contentType}</span>}
        </p>
      </div>
      {/* The checkerboard is not decoration: without it a transparent PNG on a dark
          panel is indistinguishable from one with a black background, which is exactly
          the thing you open an image response to check. */}
      <div className="media-stage" data-checkered="true">
        <img
          className="media-image"
          data-fit={fit}
          src={url}
          alt={t('response.image.alt')}
          onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          onError={() => setBroken(true)}
        />
      </div>
    </div>
  )
}
