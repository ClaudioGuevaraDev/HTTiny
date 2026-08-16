import { useState } from 'react'
import { FileAudio, FileVideo } from 'lucide-react'
import { formatDuration } from '../../format'
import { useLocale, useT } from '../../language'
import { Placeholder } from '../Placeholder'

/**
 * Audio and video responses, played by the webview's own decoders.
 *
 * Seeking works because the asset route serves through `http.ServeContent`, which
 * answers Range requests. That is not a detail: a `<video>` handed a source that
 * cannot be ranged will not let the scrubber move at all, and base64 across the
 * binding could never have offered one.
 *
 * The two share a component because they differ only in the element and the icon —
 * `<audio>` and `<video>` are the same media element underneath, and every fact worth
 * showing is read from the same events.
 */
export function MediaBody({ kind, url, contentType }: { kind: 'audio' | 'video'; url: string; contentType: string }) {
  const { t } = useT()
  const locale = useLocale()
  const [duration, setDuration] = useState<number | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [broken, setBroken] = useState(false)

  if (broken) {
    return (
      <Placeholder
        tone="danger"
        icon={kind === 'audio' ? <FileAudio size={20} /> : <FileVideo size={20} />}
        title={t(`response.${kind}.broken.title`)}
        /* Says what to do about it, since an unsupported codec is not a bug in the
           request and there is nothing to retry. */
        description={t('response.media.broken.desc', { type: contentType || t('response.media.unknownType') })}
      />
    )
  }

  // `durationchange` rather than `loadedmetadata`: a stream whose length is not in the
  // container reports Infinity at metadata time and corrects itself later.
  const onDuration = (element: HTMLMediaElement) => {
    if (Number.isFinite(element.duration)) setDuration(element.duration * 1000)
  }

  return (
    <div className="media-body">
      <div className="media-toolbar">
        <p className="media-facts">
          {duration !== null && <span className="media-duration">{formatDuration(duration, locale)}</span>}
          {size && <span className="media-dimensions">{t('response.image.dimensions', { width: size.width, height: size.height })}</span>}
          {contentType && <span className="media-type">{contentType}</span>}
        </p>
      </div>
      <div className="media-stage">
        {kind === 'audio' ? (
          <audio className="media-audio" src={url} controls onDurationChange={event => onDuration(event.currentTarget)} onError={() => setBroken(true)} />
        ) : (
          <video
            className="media-video"
            src={url}
            controls
            onDurationChange={event => onDuration(event.currentTarget)}
            onLoadedMetadata={event => setSize({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })}
            onError={() => setBroken(true)}
          />
        )}
      </div>
    </div>
  )
}
