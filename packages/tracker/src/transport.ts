import type { FlushPayload, Geo } from './types.js';

// Hand-rolled PostgREST RPC client.
// Reasons we don't pull @supabase/supabase-js:
//   - We use ~5% of its surface (two RPCs).
//   - Dropping the dep saves ~25KB gzipped vs. our entire tracker budget.
//   - keepalive on unload (audit fix F-17) is trivial here, awkward through the SDK.

export interface RpcOptions {
  supabaseUrl: string;
  anonKey: string;
}

export interface StartSessionInput {
  shareSlug: string;
  email: string | null;
  fingerprint: string | null;
  referrer: string;
  userAgent: string;
  geo?: Geo;
}

export interface StartSessionResult {
  sessionId: string;
  token: string;
  documentId: string;
  documentVersion: number;
}

export class RpcError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus?: number,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export function createTransport(opts: RpcOptions) {
  const rpcUrl = (name: string) => `${opts.supabaseUrl}/rest/v1/rpc/${name}`;

  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    apikey: opts.anonKey,
    Authorization: `Bearer ${opts.anonKey}`,
    'Content-Type': 'application/json',
    ...extra,
  });

  async function call(rpc: string, body: object, keepalive = false): Promise<unknown> {
    const res = await fetch(rpcUrl(rpc), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      keepalive,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const code = extractCode(text) ?? `http_${res.status}`;
      throw new RpcError(code, text || res.statusText, res.status);
    }
    return res.status === 204 ? null : await res.json();
  }

  async function startSession(input: StartSessionInput): Promise<StartSessionResult> {
    const result = (await call('start_session', {
      p_share_slug: input.shareSlug,
      p_email: input.email,
      p_fingerprint: input.fingerprint,
      p_referrer: input.referrer,
      p_user_agent: input.userAgent,
      p_country_code: input.geo?.country ?? null,
      p_city: input.geo?.city ?? null,
      p_device_type: input.geo?.deviceType ?? null,
      p_os: input.geo?.os ?? null,
      p_browser: input.geo?.browser ?? null,
    })) as {
      session_id: string;
      token: string;
      document_id: string;
      document_version: number;
    };
    return {
      sessionId: result.session_id,
      token: result.token,
      documentId: result.document_id,
      documentVersion: result.document_version,
    };
  }

  async function updateSession(payload: FlushPayload, keepalive = false): Promise<void> {
    await call(
      'update_session',
      {
        p_session_id: payload.sessionId,
        p_token: payload.token,
        p_active_seconds: payload.activeSeconds,
        p_max_scroll: payload.maxScrollDepth,
        p_sections: payload.sections,
      },
      keepalive,
    );
  }

  return { startSession, updateSession };
}

function extractCode(body: string): string | null {
  // PostgREST surfaces our `raise exception ... using errcode = 'P0001'` as a JSON object
  // with `code` or `message`. We don't want to depend on a particular shape, so try a few.
  try {
    const parsed = JSON.parse(body) as { code?: string; message?: string };
    if (parsed.code) return parsed.code;
    if (parsed.message) {
      const match = /P\d{4}/.exec(parsed.message);
      if (match) return match[0];
    }
  } catch {
    // ignore, fall through
  }
  return null;
}
