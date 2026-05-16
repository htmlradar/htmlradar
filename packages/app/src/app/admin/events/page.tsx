// /admin/events — founder-only view of recent app_events + error_log + feedback.
// Gated on user.email matching ADMIN_EMAILS allowlist. No third-party tooling,
// no client JS, no dashboards — just a table for now. Add charts when there's
// data worth charting.

import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/supabase-server';
import { SectionMark } from '@/components/SectionMark';

export const runtime = 'edge';

const ADMIN_EMAILS = ['hello@htmlradar.com'];

const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SERVICE_ROLE = process.env['SUPABASE_SERVICE_ROLE_KEY']!;

interface AppEvent {
  id: number;
  timestamp: string;
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  user_id: string | null;
  user_email: string | null;
}

interface ErrorRow {
  id: number;
  timestamp: string;
  source: string;
  message: string;
  url: string | null;
}

interface FeedbackRow {
  id: number;
  timestamp: string;
  email: string | null;
  body: string;
  resolved: boolean;
}

async function fetchAll<T>(path: string): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    cache: 'no-store',
  });
  if (!res.ok) return [];
  return (await res.json()) as T[];
}

export default async function AdminEventsPage() {
  const user = await requireUser();
  if (!ADMIN_EMAILS.includes(user.email ?? '')) {
    redirect('/docs');
  }

  const [events, errors, feedback] = await Promise.all([
    fetchAll<AppEvent>(
      'recent_events?order=timestamp.desc&limit=50&select=id,timestamp,event,distinct_id,properties,user_id,user_email',
    ),
    fetchAll<ErrorRow>(
      'error_log?order=timestamp.desc&limit=20&select=id,timestamp,source,message,url',
    ),
    fetchAll<FeedbackRow>(
      'feedback?order=timestamp.desc&limit=20&select=id,timestamp,email,body,resolved',
    ),
  ]);

  // Per-event counts (rolled up across the 50-row sample)
  const eventCounts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.event] = (acc[e.event] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="py-8">
      <SectionMark>Admin · Events</SectionMark>
      <h1 className="text-letterpress mt-4 font-serif text-[34px] font-normal leading-[1.06] tracking-tightest text-ink md:text-[42px]">
        What's happening.
      </h1>

      <section className="mt-10">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          Last 50 events by type
        </h2>
        <div className="mt-3 flex flex-wrap gap-2 font-mono text-[12px]">
          {Object.entries(eventCounts)
            .sort(([, a], [, b]) => b - a)
            .map(([name, count]) => (
              <span
                key={name}
                className="rounded-full border border-line bg-paper px-3 py-1 text-ink"
              >
                {name} <span className="text-graphite">· {count}</span>
              </span>
            ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          Recent events (newest first)
        </h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-paper">
          <table className="w-full text-[13px]">
            <thead className="bg-paper-2/50 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Properties</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-3 font-mono text-[11px] text-graphite">
                    {new Date(e.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-ink">{e.event}</td>
                  <td className="px-4 py-3 text-[12px] text-ink-soft">
                    {e.user_email ?? e.distinct_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-graphite">
                    {Object.keys(e.properties).length > 0
                      ? JSON.stringify(e.properties).slice(0, 80)
                      : '—'}
                  </td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-graphite">
                    No events yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          Recent errors (last 20)
        </h2>
        <div className="mt-3 rounded-xl border border-line bg-paper">
          {errors.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-graphite">No errors. Good.</p>
          ) : (
            <ul className="divide-y divide-line">
              {errors.map((e) => (
                <li key={e.id} className="px-4 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
                    {new Date(e.timestamp).toLocaleString()} · {e.source}
                  </div>
                  <div className="mt-1 text-[13.5px] text-ink">{e.message}</div>
                  {e.url && <div className="mt-1 font-mono text-[11px] text-graphite">{e.url}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          Feedback inbox (last 20)
        </h2>
        <div className="mt-3 rounded-xl border border-line bg-paper">
          {feedback.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-graphite">
              No feedback yet. Link at /feedback.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {feedback.map((f) => (
                <li key={f.id} className="px-4 py-4">
                  <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
                    <span>
                      {new Date(f.timestamp).toLocaleString()} · {f.email ?? '(anonymous)'}
                    </span>
                    {f.resolved && <span className="text-signal-dark">Resolved</span>}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">
                    {f.body}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
