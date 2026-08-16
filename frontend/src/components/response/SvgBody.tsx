import { useT } from '../../language'
import { svgDataUrl } from '../../response/bytes'

/**
 * An SVG response, rendered.
 *
 * SVG is the one format that belongs to both families, and it is handled as text on
 * purpose. An SVG document can carry `<script>`, so serving it from the asset route —
 * the app's own origin — would be handing a remote server a same-origin document. As
 * text it goes through a data URL into an `<img>` instead, and an `<img>` never runs
 * script, whatever the document contains. That is a guarantee of the element, not a
 * sanitiser we would have to keep correct.
 *
 * Its source is one click away through the same pretty/raw control every other textual
 * body uses, rather than through a toggle of its own: an SVG that renders as nothing —
 * no viewBox, a zero-size root, a namespace typo — is diagnosed by reading it, and that
 * is most of why an HTTP client fetches one.
 */
export function SvgBody({ source }: { source: string }) {
  const { t } = useT()
  const url = svgDataUrl(source)

  return (
    <div className="media-body">
      {/* Checkered for the same reason an image response is: an SVG with no background
          of its own is the normal case, and on a flat panel you cannot tell that from
          one painted the same colour. */}
      <div className="media-stage" data-checkered="true">
        {url && <img className="media-image" data-fit="fit" src={url} alt={t('response.svg.alt')} />}
      </div>
    </div>
  )
}
