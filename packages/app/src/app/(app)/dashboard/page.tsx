// /dashboard — Analytics overview. Lists every share with view counts +
// last-seen timestamp. When the user has zero shares yet, the page
// renders a clearly-labeled SampleDashboard so the empty state still
// reads as a product, not a blank canvas.

import Link from 'next/link';
import { requireUser, serverClient } from '@/lib/supabase-server';
import { resolveRecipientIdentity } from '@/lib/recipient-identity';
import type { Viewer } from '@/lib/types';
import { SectionMark } from '@/components/SectionMark';
import { SampleDashboard } from '@/components/SampleDashboard';
import { ArrowRight } from 'lucide-react';

export const runtime = 'edge';

export default async function DashboardPage() {
  await requireUser();
  const supabase = serverClient();

  // Filter out shares whose parent document was soft-deleted. Without
  // this, orphan shares show up in the list and clicking through to
  // /docs/[id] hits a 404 (since /docs/[id] filters `deleted_at IS
  // null`). Until we cascade-soft-delete shares (post-launch P-004),
  // this defensive join filter prevents the dead-end.
  const { data: shares } = await supabase
    .from('document_shares')
    .select(
      'id, slug, recipient_label, require_email, created_at, document_id, documents!inner(title, deleted_at)',
    )
    .is('documents.deleted_at', null)
    .order('created_at', { ascending: false });

  const shareIds = (shares ?? []).map((s) => s.id);
  const stats = new Map<string, { views: number; lastSeen: string | null }>();
  const viewersByShare = new Map<string, Pick<Viewer, 'email' | 'first_seen'>[]>();
  if (shareIds.length > 0) {
    const [sessionsRes, viewersRes] = await Promise.all([
      supabase.from('sessions').select('share_id, started_at').in('share_id', shareIds),
      supabase.from('viewers').select('share_id, email, first_seen').in('share_id', shareIds),
    ]);
    for (const s of sessionsRes.data ?? []) {
      const cur = stats.get(s.share_id) ?? { views: 0, lastSeen: null };
      cur.views += 1;
      cur.lastSeen = cur.lastSeen && cur.lastSeen > s.started_at ? cur.lastSeen : s.started_at;
      stats.set(s.share_id, cur);
    }
    for (const v of viewersRes.data ?? []) {
      const list = viewersByShare.get(v.share_id) ?? [];
      list.push({ email: v.email, first_seen: v.first_seen });
      viewersByShare.set(v.share_id, list);
    }
  }

  const hasShares = (shares?.length ?? 0) > 0;

  // When the user has zero shares, the empty-state CTA branches on
  // whether they have any documents yet. If they have docs but no
  // shares, the next step is "create a share" — not "upload a
  // document." (UX audit Important #12.)
  let emptyCta: { label: string; href: string } | undefined;
  if (!hasShares) {
    const { count: docsCount } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null);
    emptyCta =
      (docsCount ?? 0) > 0
        ? { label: 'Create your first share', href: '/docs' }
        : { label: 'Upload your first document', href: '/new' };
  }

  return (
    <div className="py-8">
      <SectionMark>Analytics</SectionMark>

      {!hasShares ? (
        <div className="mt-6">
          <SampleDashboard ctaLabel={emptyCta!.label} ctaHref={emptyCta!.href} />
        </div>
      ) : (
        <>
          <h1 className="text-letterpress mt-6 font-serif text-[36px] font-normal leading-[1.06] tracking-tightest text-ink md:text-[44px]">
            Your shares.
          </h1>
          <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-ink-soft">
            Every share you've created, with view counts and the last time a recipient opened it.
            Click into one for section-level dwell.
          </p>

          <ul className="mt-8 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
            {shares!.map((s) => {
              const stat = stats.get(s.id) ?? { views: 0, lastSeen: null };
              const title = Array.isArray(s.documents)
                ? (s.documents[0] as { title: string } | undefined)?.title
                : (s.documents as unknown as { title: string } | null)?.title;
              const viewers = viewersByShare.get(s.id) ?? [];
              const identity = resolveRecipientIdentity(
                { recipient_label: s.recipient_label, require_email: s.require_email },
                viewers,
              );
              const hasViewers = viewers.length > 0;
              return (
                <li key={s.id}>
                  <Link
                    href={`/dashboard/${s.slug}`}
                    className="group flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-paper-2/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-serif text-[18px] text-ink">
                        {title ?? 'Untitled'}
                      </div>
                      <div className="mt-1 truncate text-[12.5px] text-ink-soft">
                        {hasViewers ? (
                          <>
                            Opened by <span className="text-ink">{identity.primary}</span>
                            {identity.secondary && (
                              <span className="text-graphite">
                                {' '}
                                · labelled {identity.secondary}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-graphite">{identity.primary}</span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-graphite">
                        /r/{s.slug}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-serif text-[20px] tabular-nums text-ink">
                        {stat.views}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-graphite">
                        {stat.views === 1 ? 'view' : 'views'}
                        {' · '}
                        {stat.lastSeen ? new Date(stat.lastSeen).toLocaleString() : 'no opens yet'}
                      </div>
                    </div>
                    <ArrowRight
                      aria-hidden
                      className="size-4 shrink-0 text-graphite transition group-hover:translate-x-0.5 group-hover:text-signal-dark"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
