// Tiny icon re-exports kept local to the v2 directory so we don't pollute
// the global icon imports until the v2 page is the canonical one. When
// /v2 flips to /docs/[id], delete this file and inline the lucide-react
// imports.

export { BarChart3, History, Share2 } from 'lucide-react';
// Note: `Plus` is imported directly inside ShareCardList where it's needed.
export type { LucideIcon } from 'lucide-react';
