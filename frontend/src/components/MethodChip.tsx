import { methodLabel, methodToken, type HttpMethod } from '../types'

export type MethodChipVariant = 'chip' | 'compact' | 'ghost'

/**
 * Replaces the old `methodColor` map, which returned Tailwind class strings like
 * `text-emerald-400`. Three problems with that: those utilities stop existing once
 * the default palette is closed off; a bare coloured word at 11px on near-black is a
 * weak signal in a dense tree; and it coupled `types.ts`, a pure contract module, to
 * a CSS framework's utility vocabulary.
 *
 * Variants rather than boolean props, per the project's own composition-patterns
 * guidance:
 *  - `chip`    filled pill for the sidebar tree
 *  - `compact` same pill on a narrower floor, for tabs and palette rows
 *  - `ghost`   borderless, for inside the method field where the control has its own frame
 *
 * The two filled variants label themselves through `methodLabel`, which shortens OPTIONS
 * to "OPTS" and nothing else; `ghost` always spells the method out, because that is the
 * method *picker* and it should name what you are choosing.
 *
 * DELETE used to be "DEL" in `compact`, which made a tab and its own tree row disagree
 * about the request. It spells itself out everywhere now and drops to 10px where the
 * column is tight — see the HTTP methods section in `components.css`.
 *
 * The colour itself comes from the cascade: `.method-get` and friends each set a
 * single `--method` custom property, so the chip recipe is written once.
 */
export function MethodChip({ method, variant = 'chip', decorative = false }: { method: HttpMethod; variant?: MethodChipVariant; decorative?: boolean }) {
  return (
    <span
      className={`method-chip method-chip-${variant} method-${methodToken(method)}`}
      data-method={methodToken(method)}
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : method}
    >
      {variant === 'ghost' ? method : methodLabel[method]}
    </span>
  )
}
