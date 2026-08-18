import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { FileX2 } from 'lucide-react'
import { requestBodyEditorId } from '../../domIds'
import { httinyTheme } from '../../editorTheme'
import type { PlainMessageKey } from '../../i18n'
import { useT } from '../../language'
import { useAppStore } from '../../store'
import type { BodyType, RequestDocument } from '../../types'
import { useRovingFocus } from '../../useRovingFocus'
import { KeyValueGrid } from '../KeyValueGrid'
import { Placeholder } from '../Placeholder'
import { BinaryBody } from './BinaryBody'
import { FormGrid } from './FormGrid'

/**
 * The order the picker offers, which is roughly how often each is wanted. The labels
 * used to be `type.toUpperCase()`, which worked while all three members were tokens;
 * `Form`, `URL-encoded` and `Binary` are words, so they come out of the catalogue and
 * `JSON`/`TEXT` keep the token spelling by being literals here.
 */
const BODY_TYPES = ['none', 'json', 'text', 'form', 'urlencoded', 'binary'] as const satisfies readonly BodyType[]

const BODY_TYPE_LABEL: Record<BodyType, PlainMessageKey | null> = {
  none: 'editor.body.none',
  json: null,
  text: null,
  form: 'editor.body.form',
  urlencoded: 'editor.body.urlencoded',
  binary: 'editor.body.binary',
}

/** The two types CodeMirror reads. Everything else has an editor of its own. */
const isTextual = (type: BodyType): type is 'json' | 'text' => type === 'json' || type === 'text'

export function BodyEditor({ request }: { request: RequestDocument }) {
  const { t } = useT()
  const setBody = useAppStore(s => s.setBody)
  const onSegmentKeyDown = useRovingFocus('[role="radio"]')
  const type = request.body.type

  return (
    <div className="body-editor">
      <div className="editor-toolbar">
        {/* A radiogroup rather than a tablist: these pick what the body *is*, they do not
            switch between panels. Arrow keys move within it, per the ARIA radio pattern. */}
        <div className="segmented" role="radiogroup" aria-label={t('editor.body.type')} onKeyDown={onSegmentKeyDown}>
          {BODY_TYPES.map(member => {
            const label = BODY_TYPE_LABEL[member]
            return (
              <button
                type="button"
                key={member}
                role="radio"
                aria-checked={type === member}
                tabIndex={type === member ? 0 : -1}
                className={type === member ? 'active' : ''}
                onClick={() => setBody(request.id, { type: member })}
              >
                {label ? t(label) : member.toUpperCase()}
              </button>
            )
          })}
        </div>
        {type === 'json' && (
          <button
            type="button"
            className="text-action"
            onClick={() => {
              try {
                setBody(request.id, { content: JSON.stringify(JSON.parse(request.body.content), null, 2) })
              } catch {
                /* Leave malformed JSON alone rather than destroying what was typed. */
              }
            }}
          >
            {t('editor.body.formatJson')}
          </button>
        )}
      </div>
      {type === 'none' && <Placeholder icon={<FileX2 size={20} />} title={t('editor.body.emptyTitle')} description={t('editor.body.emptyDesc')} />}
      {isTextual(type) && (
        <CodeMirror
          /* Marks this editor for `useGlobalShortcuts`, which otherwise sends Ctrl+F to
             the response viewer's find bar. This one keeps CodeMirror's own search
             panel — searching the body you are editing is its own thing. */
          id={requestBodyEditorId}
          value={request.body.content}
          height="100%"
          theme={httinyTheme}
          extensions={type === 'json' ? [json()] : []}
          onChange={content => setBody(request.id, { content })}
          basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
          aria-label={t('editor.body.aria', { type: type.toUpperCase() })}
        />
      )}
      {type === 'form' && <FormGrid request={request} />}
      {type === 'urlencoded' && (
        <KeyValueGrid
          rows={request.body.urlencoded}
          onChange={rows => setBody(request.id, { urlencoded: rows })}
          addLabel="editor.body.urlencoded.add"
          name="urlencoded"
        />
      )}
      {type === 'binary' && <BinaryBody request={request} />}
    </div>
  )
}
