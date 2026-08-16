import { useT } from '../../language'

/**
 * Renders an HTML response, in a frame that can do nothing.
 *
 * `sandbox=""` — the empty value, not an omitted attribute — is the whole design. An
 * empty sandbox denies every capability the flag list can grant: no scripts, no forms,
 * no popups, no top-level navigation, no pointer lock, and a unique opaque origin, so
 * the document cannot reach this application's storage, its DOM, or the Wails runtime
 * that sits behind it. A page fetched from an arbitrary endpoint is exactly the input
 * that must not be trusted, and `srcdoc` under an empty sandbox is the only way to put
 * one on screen without deciding, tag by tag, what it is allowed to do.
 *
 * There is deliberately no `<base>`. Relative URLs in the page therefore resolve
 * against nothing and its subresources do not load: no images fetched from the origin
 * server, no stylesheets, no tracking pixel fired by opening a response in an HTTP
 * client. The trade is honest and stated in the notice — this shows the document's own
 * structure and inline styling, not the page as a browser would assemble it. Adding a
 * base would make it prettier and would turn viewing a response into issuing a dozen
 * more requests the user never asked for.
 *
 * `allow-scripts` is not offered as an opt-in. Combined with the opaque origin it would
 * still be sandboxed, but a switch labelled "run this stranger's JavaScript" is not a
 * decision to put in a toolbar next to the word count.
 */
export function HtmlPreview({ source }: { source: string }) {
  const { t } = useT()

  return (
    <div className="html-preview">
      <p className="response-notice">{t('response.html.sandboxed')}</p>
      <iframe className="html-frame" title={t('response.html.title')} sandbox="" srcDoc={source} referrerPolicy="no-referrer" />
    </div>
  )
}
