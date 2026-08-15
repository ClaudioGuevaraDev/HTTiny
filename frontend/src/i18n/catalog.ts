import type { en } from './en'

/**
 * The type machinery, kept apart from the runtime so `es.ts` can be annotated without
 * importing the module that imports it back.
 *
 * The whole design rests on one thing: `en` is `as const`, so every message is a string
 * *literal* type and the `{name}` slots can be read out of it at compile time. A call
 * that forgets a param, or invents one, is a `tsc` error rather than a `{name}` on
 * screen — which matters more here than usual, because the project has no tests.
 */
export type MessageKey = keyof typeof en

/**
 * Every catalogue but `en` is checked against `en`'s key set.
 *
 * An annotation rather than `satisfies`: only an annotation makes a *missing* key an
 * error, and a forgotten translation is exactly the failure worth catching. `en` gets
 * the opposite treatment — no annotation, so `as const` keeps the literal types.
 */
export type Catalog = Record<MessageKey, string>

/** Matched conservatively, so a stray brace in copy is never mistaken for a slot. */
export const SLOT = /\{([A-Za-z][A-Za-z0-9]*)\}/g

/** The `{name}` slots in a message, as a union of their names. Recurses once per slot — two at most here. */
type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}` ? P | Placeholders<Rest> : never

export type Values = Record<string, string | number>

type ParamsOf<K extends MessageKey> = Placeholders<(typeof en)[K]>

/** A message with no slots takes no second argument at all; one with slots requires exactly them. */
type Args<K extends MessageKey> = [ParamsOf<K>] extends [never] ? [] : [params: Record<ParamsOf<K>, string | number>]

export interface Translate {
  <K extends MessageKey>(key: K, ...args: Args<K>): string
}

/**
 * The keys whose message takes no parameters.
 *
 * For the places that carry a key around as a *value* — a label map, a command
 * definition — where the variable's type is a union and `t()` would otherwise demand
 * the union of every parameter any member might want. Narrowing the union to the
 * parameterless keys is what makes `t(someKey)` legal there, and it fails at compile
 * time the day a translated message grows a slot.
 */
export type PlainMessageKey = { [K in MessageKey]: [ParamsOf<K>] extends [never] ? K : never }[MessageKey]

/** Every key that has both a `.one` and an `.other` form — the only roots `plural` accepts. */
export type PluralRoot = {
  [K in MessageKey]: K extends `${infer R}.other` ? (`${R}.one` extends MessageKey ? R : never) : never
}[MessageKey]

type PluralParamsOf<R extends PluralRoot> = Exclude<Placeholders<(typeof en)[`${R}.other` & MessageKey]>, 'count'>

/** `count` is supplied by the call itself, so it never has to be passed twice. */
type PluralArgs<R extends PluralRoot> = [PluralParamsOf<R>] extends [never] ? [] : [params: Record<PluralParamsOf<R>, string | number>]

export interface Plural {
  <R extends PluralRoot>(root: R, count: number, ...args: PluralArgs<R>): string
}

/** What `useT()` hands a component, and what `translate` is outside React. */
export interface Translator {
  t: Translate
  plural: Plural
}
