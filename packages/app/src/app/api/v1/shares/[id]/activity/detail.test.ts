// GET /api/v1/shares/{id}/activity?include_detail=true
//
// The default report is deliberately minimal: sections, times, scroll and the
// email somebody typed at the gate. Where the reader was and what they read
// on is a named person's location and device, it would be passing through a
// language model, and it is only sent when the caller asks for it by name
// (31 August 2026 decision). The data is loaded either way — the parameter is
// about what leaves the building, not about work.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const SHARE_ID = '11111111-2222-4333-8444-555555555555';

const db = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
}));

vi.mock('@/lib/error-log', () => ({ logServerError: vi.fn() }));

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  authenticateApiKey: async () => ({ caller: { userId: 'user-1', tier: 'pro', scope: 'full' } }),
  serviceClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        maybeSingle: async () => ({ data: db.rows[table]?.[0] ?? null }),
        then: (resolve: (value: { data: unknown }) => void) =>
          resolve({ data: db.rows[table] ?? [] }),
      };
      return chain;
    },
  }),
}));

import { GET } from './route';

beforeEach(() => {
  db.rows = {
    document_shares: [
      { id: SHARE_ID, slug: 'acme-deck', owner_id: 'user-1', recipient_label: 'Acme' },
    ],
    viewers: [
      {
        id: 'v-1',
        email: 'jane@acme.com',
        last_seen: '2026-08-29T09:00:00Z',
        country_code: 'GB',
        city: 'London',
        device_type: 'desktop',
        referrer: 'https://mail.google.com/',
        is_internal: false,
      },
      {
        id: 'v-2',
        email: 'jane@acme.com',
        last_seen: '2026-08-30T18:00:00Z',
        country_code: 'FR',
        city: 'Paris',
        device_type: 'mobile',
        referrer: null,
        is_internal: false,
      },
    ],
    sessions: [
      {
        id: 's-1',
        viewer_id: 'v-1',
        started_at: '2026-08-29T09:00:00Z',
        last_heartbeat_at: '2026-08-29T09:05:00Z',
        active_time_seconds: 60,
        max_scroll_depth: 0.4,
      },
      {
        id: 's-2',
        viewer_id: 'v-2',
        started_at: '2026-08-30T18:00:00Z',
        last_heartbeat_at: '2026-08-30T18:04:00Z',
        active_time_seconds: 120,
        max_scroll_depth: 0.9,
      },
    ],
    section_events: [],
  };
});

async function activity(query = '') {
  const req = new Request(`https://htmlradar.com/api/v1/shares/${SHARE_ID}/activity${query}`, {
    headers: { authorization: `Bearer hr_live_${'a'.repeat(40)}` },
  }) as unknown as NextRequest;
  const res = await GET(req, { params: { id: SHARE_ID } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function viewers(body: Record<string, unknown>) {
  return body['viewers'] as Record<string, unknown>[];
}

describe('the activity report and the reader behind it', () => {
  it('says nothing about location or device unless it was asked to', async () => {
    const res = await activity();
    expect(res.status).toBe(200);
    const [viewer] = viewers(res.body);
    expect(viewer).toMatchObject({ email: 'jane@acme.com', label: 'Acme' });
    expect(viewer).not.toHaveProperty('detail');
    expect(JSON.stringify(res.body)).not.toContain('London');
  });

  // One person, two devices, one answer: where they were the last time, not
  // an average of two places.
  it('adds country, city, device and referrer from the most recent visit when asked', async () => {
    const [viewer] = viewers((await activity('?include_detail=true')).body);
    expect(viewer?.['detail']).toEqual({
      country: 'FR',
      city: 'Paris',
      device: 'mobile',
      referrer: null,
    });
  });

  it('takes only the exact word, so a near miss is still the minimal report', async () => {
    for (const query of ['?include_detail=1', '?include_detail=yes', '?include_detail=']) {
      const [viewer] = viewers((await activity(query)).body);
      expect(viewer).not.toHaveProperty('detail');
    }
  });
});
