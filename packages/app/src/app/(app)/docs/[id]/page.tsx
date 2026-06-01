// /docs/[id] — Canonical document detail page.
//
// Thin re-export of the tabbed (Sharing / Analytics / Versions) layout in
// `./v2/page.tsx`; `/docs/[id]/v2` resolves to the same component.

export const runtime = 'edge';
export { default } from './v2/page';
