// Shared between page.tsx (Server Component) and DocTabsClient.tsx
// (Client Component). Living in its own non-client module is mandatory:
// any non-component export from a 'use client' file becomes a
// client-reference proxy when imported from a Server Component and
// throws "X is not a function" at runtime (exactly the bug that hit
// us on 2026-05-26).

export type TabKey = 'sharing' | 'analytics' | 'versions';

export function normalizeTab(raw: string | null | undefined): TabKey {
  if (raw === 'analytics' || raw === 'versions') return raw;
  return 'sharing';
}
