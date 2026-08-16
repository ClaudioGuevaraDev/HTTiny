import { FileText } from 'lucide-react'
import { formatBytes } from '../../format'
import { useLocale, useT } from '../../language'
import { Placeholder } from '../Placeholder'

/**
 * A PDF response, handed to whatever viewer the platform's webview ships.
 *
 * `<object>` rather than `<embed>` on purpose: it is the one element whose children
 * are defined to render when the engine cannot handle the data. WebView2 and WKWebView
 * both carry a PDF viewer; WebKitGTK does not, and on Linux this degrades to the card
 * below instead of an empty grey rectangle. That fallback is the entire reason for the
 * element choice.
 */
export function PdfBody({ url, sizeBytes }: { url: string; sizeBytes: number }) {
  const { t } = useT()
  const locale = useLocale()

  return (
    <div className="media-body">
      <object className="media-pdf" type="application/pdf" data={url} aria-label={t('response.pdf.aria')}>
        <Placeholder
          icon={<FileText size={20} />}
          title={t('response.pdf.unsupported.title')}
          description={t('response.pdf.unsupported.desc', { size: formatBytes(sizeBytes, locale) })}
        />
      </object>
    </div>
  )
}
