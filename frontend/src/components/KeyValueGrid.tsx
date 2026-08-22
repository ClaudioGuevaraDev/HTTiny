import { Check, Plus, Trash2 } from 'lucide-react'
import type { MessageKey, PlainMessageKey } from '../i18n'
import { useT } from '../language'
import { freshRow } from '../store'
import type { KeyValueRow } from '../types'

type Field = 'key' | 'value' | 'description'

const FIELD_LABEL = {
  key: 'editor.kv.key',
  value: 'editor.kv.value',
  description: 'editor.kv.description',
} as const satisfies Record<Field, MessageKey>

/**
 * Deliberately generic rather than worked examples. The example-pattern rule is for
 * single-purpose fields whose format is not obvious — the URL and the bearer token get
 * one. In a repeating grid any example is arbitrary, and it repeats down every empty
 * row, where two greyed "page…" cells read as duplicated data rather than as a hint.
 */
const PLACEHOLDER = {
  key: 'editor.kv.keyPlaceholder',
  value: 'editor.kv.valuePlaceholder',
  description: 'editor.kv.descriptionPlaceholder',
} as const satisfies Record<Field, MessageKey>

/**
 * The key/value grid, over rows and a setter rather than over a document and a field
 * name.
 *
 * It used to take `field: 'params' | 'headers'` and call `setRows(id, field, …)`
 * itself, which is exactly one member short of what it is now asked to do: the
 * URL-encoded body is a third grid with the same three columns and a different home in
 * the document. Owning neither the rows nor where they live is what makes it serve all
 * three, and the caller keeps the one thing that genuinely differs — what a commit
 * means. For Params that is also rewriting the URL.
 *
 * `name` prefixes the inputs' form names, which is the only reason the grid needs to
 * know which one it is.
 */
export function KeyValueGrid({
  rows,
  onChange,
  addLabel,
  name,
}: {
  rows: KeyValueRow[]
  onChange: (rows: KeyValueRow[]) => void
  addLabel: PlainMessageKey
  name: string
}) {
  const { t } = useT()
  return (
    <div className="kv-wrap">
      <div className="kv-header">
        <span />
        {/* Sentence case in the catalogue; `.kv-header` does the uppercasing, so a
            Spanish accent is never lost to a hand-typed capital. */}
        <span>{t('editor.kv.key')}</span>
        <span>{t('editor.kv.value')}</span>
        <span>{t('editor.kv.description')}</span>
        <span />
      </div>
      {rows.map(row => (
        <div className="kv-row" key={row.id}>
          <button
            type="button"
            className={`row-check ${row.enabled ? 'on' : ''}`}
            role="switch"
            aria-checked={row.enabled}
            aria-label={row.key ? t('editor.kv.enableNamed', { name: row.key }) : t('editor.kv.enableRow')}
            onClick={() => onChange(rows.map(r => (r.id === row.id ? { ...r, enabled: !r.enabled } : r)))}
          >
            {row.enabled && <Check size={11} aria-hidden="true" />}
          </button>
          {(['key', 'value', 'description'] as const).map(field => (
            <input
              key={field}
              className="technical-input"
              value={row[field]}
              name={`${name}-${field}`}
              aria-label={t(FIELD_LABEL[field])}
              placeholder={t(PLACEHOLDER[field])}
              // Header names and values are code tokens, not prose: a password manager
              // offering to fill them, or a red squiggle under `X-Api-Key`, is noise.
              autoComplete="off"
              spellCheck={field === 'description'}
              onChange={e => onChange(rows.map(r => (r.id === row.id ? { ...r, [field]: e.target.value } : r)))}
            />
          ))}
          <button
            type="button"
            className="icon-btn xs row-delete"
            aria-label={t('editor.kv.deleteRow')}
            onClick={() => onChange(rows.filter(r => r.id !== row.id))}
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" className="add-row" onClick={() => onChange([...rows, freshRow()])}>
        <Plus size={13} aria-hidden="true" />
        {/* One whole message per caller rather than "Add" plus a noun: the article and
            the gender travel with the noun in Spanish. */}
        {t(addLabel)}
      </button>
    </div>
  )
}
