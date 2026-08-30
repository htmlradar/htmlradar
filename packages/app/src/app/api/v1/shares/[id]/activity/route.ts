// GET /api/v1/shares/{share_id}/activity — who read this link, and where they
// spent their time.
//
// Same three tables and the same four filters the per-share dashboard page
// applies (app/(app)/dashboard/[slug]/page.tsx), because an API that reports
// different numbers from the page the customer is looking at is worse than no
// API. Those filters are:
//
//   1. internal viewers (the owner's own test reads, @htmlradar staff) are out;
//   2. phantom sessions — bounced with zero active time and zero scroll, a
//      tracker ghost — are out;
//   3. meta "sections" (page numbers, "01 / 14") are out;
//   4. a session's section dwell is rescaled so it cannot exceed that
//      session's active time, which stale pre-fix tracker data violates.
//
// The aggregation lives inline on that page rather than in a shared function,
// and it is a page-render concern shaped for its own components; what is
// reused here is the filtering rules, not a copy of its output shape.

import type { NextRequest } from 'next/server';
import {
  authenticateApiKey,
  errorResponse,
  INVALID_KEY,
  jsonResponse,
  serviceClient,
} from '@/lib/api-auth';
import { isMetaSectionTitle } from '@/lib/section-filter';
import type { Session, SectionEvent, Viewer } from '@/lib/types';

export const runtime = 'edge';

const SITE_URL = 'https://htmlradar.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = { status: 404, body: { error: 'not_found' } };

interface ViewerOut {
  label: string | null;
  email: string | null;
  first_open: string;
  last_seen: string;
  active_seconds: number;
  max_scroll: number;
  sections: { title: string; time_seconds: number }[];
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await authenticateApiKey(req);
  if (!caller) return errorResponse(INVALID_KEY);

  // A malformed id is a 404, not a Postgres cast error surfaced to the caller.
  if (!UUID.test(params.id)) return errorResponse(NOT_FOUND);

  const supabase = serviceClient();
  const { data: share } = await supabase
    .from('document_shares')
    .select('id, slug, owner_id, recipient_label')
    .eq('id', params.id)
    .maybeSingle();

  // Someone else's link is indistinguishable from one that does not exist —
  // a key must not be usable to probe for share ids.
  if (!share || share.owner_id !== caller.userId) return errorResponse(NOT_FOUND);

  const shareUrl = `${SITE_URL}/r/${share.slug}`;

  const [{ data: viewerRows }, { data: sessionRows }] = await Promise.all([
    supabase.from('viewers').select('*').eq('share_id', share.id),
    supabase.from('sessions').select('*').eq('share_id', share.id),
  ]);

  const viewers = (viewerRows ?? []) as Viewer[];
  const internalViewerIds = new Set(viewers.filter((v) => v.is_internal === true).map((v) => v.id));

  const sessions = ((sessionRows ?? []) as Session[]).filter(
    (s) =>
      !internalViewerIds.has(s.viewer_id) &&
      !(
        s.bounced === true &&
        (s.active_time_seconds ?? 0) === 0 &&
        (s.max_scroll_depth ?? 0) === 0
      ),
  );

  if (sessions.length === 0) {
    return jsonResponse(200, {
      share_id: share.id,
      url: shareUrl,
      opened: false,
      viewers: [],
    });
  }

  const sectionEvents = await loadSections(
    supabase,
    sessions.map((s) => s.id),
  );

  // One row per PERSON: same email = same person however many devices they
  // used; an anonymous viewer is their own person. Mirrors countDistinctViewers
  // and how ViewerInsights groups.
  const viewerById = new Map(viewers.map((v) => [v.id, v]));
  const groupKeyOf = (viewerId: string) =>
    viewerById.get(viewerId)?.email?.trim().toLowerCase() || viewerId;

  const sessionActiveSeconds = new Map(sessions.map((s) => [s.id, s.active_time_seconds ?? 0]));
  const sessionScale = scaler(sectionEvents, sessionActiveSeconds);

  const groups = new Map<
    string,
    { email: string | null; sessions: Session[]; sections: Map<string, SectionRow> }
  >();
  for (const session of sessions) {
    const key = groupKeyOf(session.viewer_id);
    const group = groups.get(key) ?? {
      email: viewerById.get(session.viewer_id)?.email ?? null,
      sessions: [],
      sections: new Map<string, SectionRow>(),
    };
    group.sessions.push(session);
    groups.set(key, group);
  }

  const sessionToKey = new Map(sessions.map((s) => [s.id, groupKeyOf(s.viewer_id)]));
  for (const event of sectionEvents) {
    const group = groups.get(sessionToKey.get(event.session_id) ?? '');
    if (!group) continue;
    const row = group.sections.get(event.section_id) ?? {
      title: event.section_title ?? event.section_id,
      seconds: 0,
      ordinal: Number.POSITIVE_INFINITY,
    };
    row.seconds += event.time_seconds * sessionScale(event.session_id);
    if (typeof event.ordinal === 'number' && event.ordinal < row.ordinal)
      row.ordinal = event.ordinal;
    group.sections.set(event.section_id, row);
  }

  const out: ViewerOut[] = [...groups.values()]
    .map((group) => ({
      // The sender's own label for this link. It is the only human name the
      // product holds for an anonymous reader, and for a per-recipient link it
      // is exactly who the sender meant.
      label: share.recipient_label ?? null,
      email: group.email,
      first_open: min(group.sessions.map((s) => s.started_at)),
      last_seen: max(group.sessions.map((s) => s.last_heartbeat_at ?? s.started_at)),
      active_seconds: round(
        group.sessions.reduce((sum, s) => sum + (s.active_time_seconds ?? 0), 0),
      ),
      max_scroll: Math.max(0, ...group.sessions.map((s) => s.max_scroll_depth ?? 0)),
      sections: [...group.sections.values()]
        // Deck order — the narrative as the sender wrote it. Sections with no
        // recorded ordinal (older reads) fall to the end.
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((s) => ({ title: s.title, time_seconds: round(s.seconds) })),
    }))
    .sort((a, b) => (a.first_open < b.first_open ? -1 : 1));

  return jsonResponse(200, {
    share_id: share.id,
    url: shareUrl,
    opened: out.length > 0,
    viewers: out,
  });
}

interface SectionRow {
  title: string;
  seconds: number;
  ordinal: number;
}

// section_events for these sessions, minus the meta/structural ones.
async function loadSections(
  supabase: ReturnType<typeof serviceClient>,
  sessionIds: string[],
): Promise<SectionEvent[]> {
  const { data } = await supabase
    .from('section_events')
    .select('session_id, section_id, section_title, time_seconds, ordinal')
    .in('session_id', sessionIds);
  return ((data ?? []) as SectionEvent[]).filter(
    (e) => !isMetaSectionTitle(e.section_title, e.section_id),
  );
}

// A session's section dwell cannot exceed the time the tab was actually
// active. Stale pre-fix tracker data over-credited; current sessions already
// satisfy this, so the factor is 1 for them.
function scaler(events: SectionEvent[], activeSeconds: Map<string, number>) {
  const sums = new Map<string, number>();
  for (const e of events) sums.set(e.session_id, (sums.get(e.session_id) ?? 0) + e.time_seconds);
  return (sessionId: string): number => {
    const active = activeSeconds.get(sessionId) ?? 0;
    const sum = sums.get(sessionId) ?? 0;
    return sum > active && sum > 0 ? active / sum : 1;
  };
}

function min(values: string[]): string {
  return values.reduce((a, b) => (a < b ? a : b));
}

function max(values: string[]): string {
  return values.reduce((a, b) => (a > b ? a : b));
}

function round(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}
