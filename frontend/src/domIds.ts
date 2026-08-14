/**
 * Element ids that two components have to agree on. A tab and the panel it controls
 * point at each other through `aria-controls`/`aria-labelledby`, so the id has to be
 * derived the same way in `RequestTabs` and in `RequestEditor` — and it cannot live in
 * either of them, since a component file that also exports a helper breaks fast refresh.
 */
export const requestTabId = (id: string) => `request-tab-${id}`
