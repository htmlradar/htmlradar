// The protocol endpoint: the same seven tools the npm package ships, served
// over Streamable HTTP with the API key the grant carries.
//
// There is no second copy of a tool here. `createServer` is imported from
// packages/mcp, unchanged, and handed a Config whose apiKey came out of the
// grant instead of out of an environment variable. Two copies of a tool
// description is how two surfaces start telling users different things.

import { createMcpHandler } from '@modelcontextprotocol/server';
import { DEFAULT_BASE_URL } from '../../mcp/src/api.js';
import { createServer } from '../../mcp/src/server.js';
import { SCOPE_READ, SCOPE_WRITE, WRITE_TOOLS, type Env, type Props } from './common.js';

// ponytail: the tool set, the descriptions and the server identity are shared
// with the stdio server verbatim. Give the remote transport its own name or
// its own `instructions` only once a real client run shows the shared wording
// misleading a browser user — not on the assumption that it will.
const handler = createMcpHandler((ctx) => {
  const extra = ctx.authInfo?.extra as { apiKey?: string; baseUrl?: string } | undefined;
  return createServer({
    apiKey: extra?.apiKey ?? '',
    baseUrl: extra?.baseUrl ?? DEFAULT_BASE_URL,
    // So a rejected key tells a remote user to reconnect, rather than to check
    // an environment variable they do not have.
    remote: true,
  });
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = (ctx as ExecutionContext & { props?: Props }).props;
    const granted = new Set((props?.scope ?? '').split(' ').filter(Boolean));

    const blocked = await toolWithoutPermission(request, granted);
    if (blocked) return insufficientScope(request, blocked.tool, blocked.needs);

    return handler.fetch(request, {
      authInfo: {
        // Deliberately empty. The handler takes this as pass-through and never
        // verifies it — the library already did — and the live access token has
        // no business travelling any further into the server than it must.
        token: '',
        clientId: '',
        scopes: [...granted],
        extra: { apiKey: props?.apiKey ?? '', baseUrl: env.API_BASE_URL },
      },
    });
  },
};

/**
 * A tool this grant may not call and the scope it needs, or null.
 *
 * Checked here rather than by hiding the tool from `tools/list`: a tool Claude
 * cannot see is a tool it cannot call, and a call it cannot make is a permission
 * upgrade the user is never offered. All seven stay visible to every grant, and
 * the refusal is what starts the step-up.
 *
 * Both directions are enforced, not only the write one. A grant that asked for
 * `shares:write` alone carries a full API key — the key has to be able to
 * publish — so if the read tools were free to everyone, a write-only connection
 * could read the account anyway. The scope, checked here, is what makes
 * write-only actually mean write-only.
 *
 * The body is read from a clone, so the request the handler serves is still
 * whole.
 */
async function toolWithoutPermission(
  request: Request,
  granted: Set<string>,
): Promise<{ tool: string; needs: string } | null> {
  if (request.method !== 'POST') return null;
  if (granted.has(SCOPE_READ) && granted.has(SCOPE_WRITE)) return null;

  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    // Not JSON, or already consumed. The handler will produce the right error;
    // nothing is being let through, because a call it cannot parse is a call it
    // cannot run.
    return null;
  }

  for (const message of Array.isArray(body) ? body : [body]) {
    const call = message as { method?: unknown; params?: { name?: unknown } } | null;
    const name = call?.params?.name;
    if (call?.method !== 'tools/call' || typeof name !== 'string') continue;
    const needs = WRITE_TOOLS.has(name) ? SCOPE_WRITE : SCOPE_READ;
    if (!granted.has(needs)) return { tool: name, needs };
  }
  return null;
}

/**
 * HTTP 403 with the challenge that makes a client offer the upgrade.
 *
 * `scope` names every scope the user should end up with, not only the missing
 * one, because clients do not reliably carry an earlier grant forward: asking
 * for the write scope alone can come back as a grant that has lost the read one.
 */
function insufficientScope(request: Request, tool: string, needs: string): Response {
  const url = new URL(request.url);
  const challenge =
    `Bearer error="insufficient_scope", ` +
    `scope="${SCOPE_READ} ${SCOPE_WRITE}", ` +
    `resource_metadata="${url.origin}/.well-known/oauth-protected-resource${url.pathname}"`;
  return new Response(
    JSON.stringify({
      error: 'insufficient_scope',
      error_description: `${tool} needs the "${needs}" permission, which this connection was not given.`,
    }),
    {
      status: 403,
      headers: { 'content-type': 'application/json', 'WWW-Authenticate': challenge },
    },
  );
}
