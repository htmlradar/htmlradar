// Thin HTTP client for the public HTMLRadar API.
//
// Every call resolves to a discriminated union rather than throwing. An MCP
// tool that throws surfaces to the calling agent as a protocol error with a
// stack trace attached; a tool that returns text surfaces as something the
// agent can read and relay. Nothing in here throws, `loadConfig` included:
// a server that exits at startup is reported as connected by several clients,
// so the user meets a dead server instead of an instruction.

export interface Config {
  /** Empty whenever the environment did not supply a usable key. */
  apiKey: string;
  baseUrl: string;
  /**
   * True when these tools are being served over the remote connector rather
   * than from a local process. It changes exactly one thing: what a rejected
   * key tells the user to do. A remote user has no `HTMLRADAR_API_KEY` to
   * check — their key was minted by the consent page and lives inside the
   * connection — so telling them to set an environment variable sends them
   * somewhere they cannot act.
   */
  remote?: boolean;
  /**
   * Why `apiKey` is empty, as one sentence naming the next step. Absent when
   * the key is usable. Every tool returns this instead of calling the API.
   */
  keyProblem?: string;
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

/** Only present when the call asked for it — see get_share_activity's include_detail. */
export interface ActivityDetail {
  country: string | null;
  city: string | null;
  device: string | null;
  referrer: string | null;
}

export interface ActivityViewer {
  label: string | null;
  email: string | null;
  first_open: string | null;
  last_seen: string | null;
  active_seconds: number;
  max_scroll: number;
  sections: ActivitySection[];
  detail?: ActivityDetail;
}

export interface ShareListItem {
  share_id: string;
  slug: string;
  url: string;
  recipient_label: string | null;
  document_id: string;
  document_title: string | null;
  created_at: string;
  revoked: boolean;
  expired: boolean;
  opened: boolean;
  last_open: string | null;
}

export interface ShareListResponse {
  shares: ShareListItem[];
  /** The cursor for the next page, or null when this was the last one. */
  next_before: string | null;
}

export interface RevokeResponse {
  share_id: string;
  url: string;
  revoked: boolean;
  revoked_at: string | null;
}

export interface ReplaceResponse {
  document_id: string;
  version: number;
  links_unchanged: boolean;
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

// The shape the app generates (packages/app/src/lib/api-auth.ts): the prefix
// and 20 random bytes as lowercase hex. `hr_test_` is accepted as plausible
// too, for a self-hosted instance reached through HTMLRADAR_API_URL; only
// `hr_live_` is issued by htmlradar.com today. Anything else never had a
// chance of authenticating, so it is treated as no key at all rather than
// sent to the API to come back as "the key was rejected".
const API_KEY_PATTERN = /^hr_(live|test)_[0-9a-f]{40}$/;

// What Claude Code's plugin, and several other clients, pass through verbatim
// when the variable they were told to forward was never exported.
const PLACEHOLDER_PATTERN = /^\$\{.*\}$/;

const WHERE_TO_GET_A_KEY =
  'Create a key at https://htmlradar.com/settings (under "API keys") and pass it to this ' +
  'server as the HTMLRADAR_API_KEY environment variable.';

// A usable key is not required to start, and none of the three ways of not
// having one is fatal. Exiting at launch produced the dead server this
// release exists to remove: the client still shows the server as connected,
// so the user gets silence instead of the sentence below.
export const NO_API_KEY_MESSAGE = `HTMLRADAR_API_KEY is not set, so this server cannot reach HTMLRadar yet. ${WHERE_TO_GET_A_KEY} Then restart this client so it picks the key up.`;

export function placeholderKeyMessage(value: string): string {
  return (
    `HTMLRADAR_API_KEY is the unresolved placeholder "${value}", which means the variable was ` +
    'not set in the environment the client started from, so this server cannot reach HTMLRadar ' +
    'yet. Export it in your shell (export HTMLRADAR_API_KEY=hr_live_...) before starting Claude ' +
    `Code or the client that launches this server. ${WHERE_TO_GET_A_KEY} Then restart this ` +
    'client so it picks the key up.'
  );
}

export const MALFORMED_API_KEY_MESSAGE =
  'HTMLRADAR_API_KEY does not look like an HTMLRadar API key, so this server cannot reach ' +
  'HTMLRadar yet. Keys are "hr_live_" followed by 40 hexadecimal characters. ' +
  `${WHERE_TO_GET_A_KEY} Then restart this client so it picks the key up.`;

/** Why this value cannot be used as a key, or null when it can. */
function keyProblem(apiKey: string): string | null {
  if (!apiKey) return NO_API_KEY_MESSAGE;
  if (PLACEHOLDER_PATTERN.test(apiKey)) return placeholderKeyMessage(apiKey);
  if (!API_KEY_PATTERN.test(apiKey)) return MALFORMED_API_KEY_MESSAGE;
  return null;
}

// The environment is passed in rather than read from `process.env` here: this
// module is bundled into the connector Worker too, where `process` does not
// exist. The stdio entry point hands it over, and stays the only file that
// knows what a process is.
export function loadConfig(env: Record<string, string | undefined>): Config {
  const apiKey = env['HTMLRADAR_API_KEY']?.trim() ?? '';
  // Trailing slashes make every request path double-slashed, which some
  // edge routers 301 to a URL that drops the Authorization header.
  const baseUrl = (env['HTMLRADAR_API_URL']?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const problem = keyProblem(apiKey);
  return problem === null ? { apiKey, baseUrl } : { apiKey: '', baseUrl, keyProblem: problem };
}

export async function apiFetch<T>(
  config: Config,
  path: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal | undefined },
): Promise<ApiResult<T>> {
  if (!config.apiKey) return { ok: false, message: config.keyProblem ?? NO_API_KEY_MESSAGE };

  const method = init?.method ?? 'GET';
  const headers: Record<string, string> = { authorization: `Bearer ${config.apiKey}` };
  if (init?.body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      ...(init?.signal ? { signal: init.signal } : {}),
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch (error) {
    // Cancellation is best effort and is never a claim that a write was
    // undone: a POST the API already accepted stays accepted. What aborting
    // buys is that we stop waiting, and that a request still in flight is
    // not left running after the caller has gone.
    if (init?.signal?.aborted) {
      return {
        ok: false,
        message:
          'The caller cancelled this call before HTMLRadar answered. If it was a create or a replace, it may still have been applied — check before trying again.',
      };
    }
    return {
      ok: false,
      message: `Could not reach the HTMLRadar API at ${config.baseUrl}: ${describe(error)}`,
    };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return { ok: true, data: payload as T };
  return { ok: false, message: errorMessage(response.status, payload, response, config) };
}

function errorMessage(
  status: number,
  payload: unknown,
  response: Response,
  config: Config,
): string {
  const body = (payload ?? {}) as {
    error?: string;
    message?: string;
    upgrade_url?: string;
    max_bytes?: number;
    retry_after_seconds?: number;
  };

  switch (body.error) {
    case 'invalid_api_key':
      // Two different people, two different next steps. A local user has an
      // environment variable to fix; a remote user has a connection to remake,
      // and the usual reason they are here is that they revoked it.
      return config.remote
        ? "HTMLRadar rejected this connection's access. It was most likely switched off under " +
            '"Connected apps" at https://htmlradar.com/settings. Reconnect HTMLRadar in this ' +
            'client to get a new one. Do not retry this call.'
        : 'HTMLRadar rejected the API key. Check HTMLRADAR_API_KEY — keys start with ' +
            '"hr_live_" and are created at https://htmlradar.com/settings under "API keys".';
    case 'rate_limited': {
      // The wait is the whole content of a 429. Dropping it leaves an agent
      // guessing, and an agent that guesses retries immediately.
      const wait = body.retry_after_seconds ?? Number(response.headers.get('retry-after') ?? '');
      const seconds = Number.isFinite(wait) && wait > 0 ? Math.ceil(wait) : null;
      return [
        seconds === null
          ? 'HTMLRadar is rate limiting this account.'
          : `HTMLRadar is rate limiting this account. Wait ${seconds} second${
              seconds === 1 ? '' : 's'
            } before trying again.`,
        'Do not retry immediately — tell the user how long the wait is.',
      ].join('\n');
    }
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
    case 'conflict':
      // Nothing was written, and a blind retry would race the same way again.
      return [
        body.message ?? 'That document changed while the replacement was being uploaded.',
        'Nothing was replaced. Check what the document says now — somebody, or another ' +
          'session, replaced or deleted it — and ask the user before trying again.',
      ].join('\n');
    case 'read_only_key':
      // Also relayed rather than retried: the key is fine, it simply does not
      // have this power, and only the user can decide to hand over one that
      // does. Where they do that differs by how they connected.
      return [
        body.message ??
          'This HTMLRadar connection is read-only and cannot create, revoke or replace anything.',
        config.remote
          ? 'Do not retry this call — tell the user, who can reconnect HTMLRadar in this client ' +
            'and choose read and publish.'
          : 'Do not retry this call — tell the user, who can create a full-access key at ' +
            'https://htmlradar.com/settings.',
      ].join('\n');
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
