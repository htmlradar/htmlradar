// Thin HTTP client for the public HTMLRadar API.
//
// Every call resolves to a discriminated union rather than throwing. An MCP
// tool that throws surfaces to the calling agent as a protocol error with a
// stack trace attached; a tool that returns text surfaces as something the
// agent can read and relay. So nothing in here throws except `loadConfig`,
// which runs once at startup before the transport is connected.

export interface Config {
  apiKey: string;
  baseUrl: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string };

export const DEFAULT_BASE_URL = 'https://htmlradar.com';

export interface ShareResponse {
  share_id: string;
  document_id: string;
  url: string;
  dashboard_url: string;
}

export interface ActivitySection {
  title: string;
  time_seconds: number;
}

export interface ActivityViewer {
  label: string | null;
  email: string | null;
  first_open: string | null;
  last_seen: string | null;
  active_seconds: number;
  max_scroll: number;
  sections: ActivitySection[];
}

export interface ActivityResponse {
  share_id: string;
  url: string;
  opened: boolean;
  viewers: ActivityViewer[];
}

export interface MeResponse {
  user_id: string;
  tier: string;
  free_links_used: number;
  free_links_cap: number | null;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const apiKey = env['HTMLRADAR_API_KEY']?.trim();
  if (!apiKey) {
    throw new Error(
      'HTMLRADAR_API_KEY is not set. Create a key at https://htmlradar.com/settings ' +
        '(under "API keys") and pass it to this server as the HTMLRADAR_API_KEY ' +
        'environment variable.',
    );
  }
  // Trailing slashes make every request path double-slashed, which some
  // edge routers 301 to a URL that drops the Authorization header.
  const baseUrl = (env['HTMLRADAR_API_URL']?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return { apiKey, baseUrl };
}

export async function apiFetch<T>(
  config: Config,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<ApiResult<T>> {
  const method = init?.method ?? 'GET';
  const headers: Record<string, string> = { authorization: `Bearer ${config.apiKey}` };
  if (init?.body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch (error) {
    return {
      ok: false,
      message: `Could not reach the HTMLRadar API at ${config.baseUrl}: ${describe(error)}`,
    };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return { ok: true, data: payload as T };
  return { ok: false, message: errorMessage(response.status, payload) };
}

function errorMessage(status: number, payload: unknown): string {
  const body = (payload ?? {}) as {
    error?: string;
    message?: string;
    upgrade_url?: string;
    max_bytes?: number;
  };

  switch (body.error) {
    case 'invalid_api_key':
      return (
        'HTMLRadar rejected the API key. Check HTMLRADAR_API_KEY — keys start with ' +
        '"hr_live_" and are created at https://htmlradar.com/settings under "API keys".'
      );
    case 'free_limit_reached':
      // Relayed verbatim on purpose: this is a billing decision for the user
      // to make, not a transient failure. Retrying will fail identically.
      return [
        body.message ?? 'You have used every free tracked link on this account.',
        body.upgrade_url ? `Upgrade: ${body.upgrade_url}` : null,
        'Do not retry this call — tell the user and let them decide.',
      ]
        .filter(Boolean)
        .join('\n');
    case 'too_large':
      return `That HTML is too large for HTMLRadar. Maximum accepted size is ${
        body.max_bytes ?? 'unknown'
      } bytes.`;
    case 'validation':
      return `HTMLRadar rejected the request: ${body.message ?? 'invalid arguments.'}`;
    case 'not_found':
      return 'No such share. Check the share id, or list your shares at https://htmlradar.com.';
    default:
      return `HTMLRadar API error (HTTP ${status})${body.message ? `: ${body.message}` : '.'}`;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
