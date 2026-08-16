import { useId, useState } from 'react'
import { useT } from '../../language'

/** The sizes a specimen is actually judged at: body copy, subhead, display. */
const SPECIMEN_SIZES = [14, 20, 32, 48]

/**
 * `format()` is a hint, not a requirement — every engine sniffs the payload anyway —
 * but supplying it lets the font load without a speculative decode. Anything not
 * listed simply omits the hint rather than guessing wrong, which would be worse than
 * saying nothing.
 */
const FORMAT_HINT: Record<string, string> = {
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'truetype',
  'font/otf': 'opentype',
  'font/collection': 'collection',
  'application/font-woff2': 'woff2',
  'application/font-woff': 'woff',
  'application/x-font-ttf': 'truetype',
  'application/x-font-otf': 'opentype',
}

/**
 * A font response, rendered as a specimen.
 *
 * There is nothing else useful to show: a font file's bytes say almost nothing in hex,
 * and the one question worth asking of an endpoint that serves one is whether the
 * glyphs are the ones you expected. So the file is installed as an `@font-face` from
 * the asset route and used to set text.
 *
 * The sample is editable because the pangram answers "does this render", and only your
 * own strings answer "does this have the glyphs I need" — which for anything outside
 * Latin is the actual question.
 */
export function FontBody({ url, contentType }: { url: string; contentType: string }) {
  const { t } = useT()
  // Scoped to this instance so two tabs showing different fonts cannot collide on a
  // family name — @font-face is global to the document however local the component is.
  const family = `httiny-specimen-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [sample, setSample] = useState(() => t('response.font.pangram'))

  const hint = FORMAT_HINT[contentType]
  const source = hint ? `url("${url}") format("${hint}")` : `url("${url}")`

  return (
    <div className="font-specimen">
      <style>{`@font-face { font-family: "${family}"; src: ${source}; font-display: block; }`}</style>
      <div className="media-toolbar">
        <label className="font-sample-label" htmlFor={`${family}-input`}>
          {t('response.font.sample')}
        </label>
        <input
          id={`${family}-input`}
          className="technical-input font-sample-input"
          value={sample}
          onChange={event => setSample(event.target.value)}
          placeholder={t('response.font.pangram')}
        />
        {contentType && <span className="media-type">{contentType}</span>}
      </div>
      <div className="font-rows">
        {SPECIMEN_SIZES.map(size => (
          <p key={size} className="font-row" style={{ fontFamily: `"${family}", sans-serif`, fontSize: `${size}px` }}>
            {/* The size label stays in the app's own font: a specimen whose caption is
                set in the font being judged cannot be read when the font is broken. */}
            <span className="font-size-label">{size}</span>
            <span className="font-sample-text">{sample || t('response.font.pangram')}</span>
          </p>
        ))}
      </div>
    </div>
  )
}
