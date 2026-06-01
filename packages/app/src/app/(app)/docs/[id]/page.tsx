// /docs/[id] — Canonical document detail page (3-tab v2 layout).
//
// Flipped on 2026-05-27 from the master-detail layout to the
// tabbed (Sharing / Analytics / Versions) v2.
//
// **Revert plan**: copy `_archived/page-v1-pre-flip-2026-05-27.tsx`
// back over this file. One operation. The v2 source still lives at
// `./v2/page.tsx` so nothing in the import graph changes during revert.
//
// Why this is a thin re-export vs. moving the v2 file up:
//   - Zero risk of accidental import-path breakage
//   - `_archived/` is git-trackable for diff vs. live
//   - `/docs/[id]/v2` continues to resolve (harmless duplicate — clean
//     up after a week of v2 stability)

export const runtime = 'edge';
export { default } from './v2/page';
