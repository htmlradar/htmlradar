# The HTMLRadar connector

The Cloudflare Worker behind `https://mcp.htmlradar.com`. It lets someone add HTMLRadar to Claude
by pasting one address, instead of installing a package and pasting an API key.

The contract this implements is `docs/workstreams/mcp-product/CONNECTOR-CONTRACT-2026-09-02.md`,
including its amendments of 3 September 2026. Where this file and that document disagree, that
document is right and this one is a bug.

## What it does, in one paragraph

A client discovers the server, is refused with a `401` that names where to sign in, and sends the
person to `htmlradar.com/connect`. That page — on the application, never here — asks them to allow
the connection and to choose read-only or read-and-publish. When they allow it, the application
mints an ordinary `hr_live_` API key, hands this Worker a one-time handle for it, and this Worker
wraps that key inside an OAuth grant. From then on every tool call is exactly the call the
`htmlradar-mcp` npm package makes, with an ordinary API key, against the same `/api/v1` endpoints.
There is no second identity system.

## The seven tools

The same seven the npm package ships, imported from `packages/mcp` rather than copied:
`whoami`, `list_shares`, `get_share_activity` (read), and `share_html`, `create_share`,
`replace_document`, `revoke_share` (write). All seven are visible to every connection. A read-only
connection calling a write tool gets `403` with a challenge that asks for both permissions, which is
what makes a client offer the upgrade rather than simply failing.

## What is honest about the security, and what is not perfect

**The API key is the off switch.** Revoking a connection in Settings sets `revoked_at` on the key
row, and every tool call carries that key to `htmlradar.com/api/v1`, where it is rejected on the very
next call. There is no cache and nothing to propagate. Everything else — telling this Worker to
forget the OAuth grant — is tidy-up that happens afterwards and is allowed to fail.

**Refresh tokens are single-use, best effort.** A refresh token we observe being spent twice is
rejected and its connection ended. Cloudflare's key-value store is eventually consistent between
locations, so two refreshes racing in two places can both read a state in which neither looks like a
replay; a reuse we do not observe may succeed once. This is stated here and in the contract in the
same words rather than being called a family revocation, which it is not.

**Access tokens live one hour** and are pinned to `https://mcp.htmlradar.com/mcp`, so a token minted
for another resource is refused here. They are not JWTs and carry no claims a client is meant to
read, but the format begins with the account identifier and the connection identifier — they are
opaque in use, not in shape.

**A connection per client.** Connecting from a second Claude account, or a second client, does not
disconnect the first. Each connection has its own key and is revoked on its own.

**Nothing here holds a database credential.** The Worker never authenticates a person, never sees a
password, and never touches Supabase. The application is the only writer on this path.

## Configuration

Plain variables, in `wrangler.toml`: `APP_BASE_URL`, `API_BASE_URL`, `SERVER_URL`, and `GIT_SHA`
bound at deploy. One key-value binding, `OAUTH_KV`, which holds the OAuth library's clients, grants
and tokens, our short-lived `tx:` records, and the `rl:` rate-limit counters.

Two secrets, set with `wrangler secret put` and never in a file: `CONNECT_SIGNING_SECRET` (the
keyed hash over both legs of the consent hand-off) and `CONNECT_EXCHANGE_SECRET` (the bearer
credential for the server-to-server handle exchange, and for the application's calls to
`/connect/revoke`). The application holds the same two values. They rotate separately on purpose: a
leak of the signing secret must not also be key theft.

The Worker refuses every request with `503` if either secret is missing or under 32 characters, if
the two are the same value, or if any base address is not `https` (loopback excepted). The log line
names the setting and never its value.

`RATE_LIMIT_SECRET` is not used. The budgets need no secret.

Two settings in `wrangler.toml` are load-bearing and their comments say so: the compatibility date,
and `global_fetch_strictly_public`, without which the OAuth library silently stops advertising
Client ID Metadata Documents and the connector accepts no client at all.

## Running it locally

```bash
pnpm install                       # from the repository root
cd packages/connector
npx vitest run                     # the tests, no network
npx wrangler dev --port 8787 --ip 127.0.0.1
```

For a live run against a stand-in for `htmlradar.com`, and for the black-box verification script,
see the Phase B build report and `verify_connector.sh` in the lane scratch folders. `wrangler dev`
rewrites the request host to the custom domain, so `SERVER_URL` must be
`http://mcp.htmlradar.com/mcp` locally or the token audience will not match.

## Deploying it

Through CI only: push to `main`, and `.github/workflows/deploy.yml` deploys this package alongside
the proxy and the monitor, then reads `X-HTMLRadar-Version` off a live `POST /mcp` to prove the
running Worker is that commit. The three connector steps are gated on the repository variable
`CONNECTOR_DEPLOY_ENABLED`, so a connector that is not provisioned cannot fail a production deploy
of everything else. What must exist before that variable is set to `true` is listed in
`docs/workstreams/mcp-product/CONNECTOR-INFRA-RUNBOOK-2026-09-02.md`, under "Before the gate opens" —
including migrations `045` and `046`, in that order.

## Turning it off

**Rollback is removing the custom-domain route.** Unsetting `CONNECTOR_DEPLOY_ENABLED` stops future
deploys and nothing else: the Worker already deployed keeps serving every request. So either remove
the `[[routes]]` block below and redeploy, or delete the domain through the API, and confirm
`POST https://mcp.htmlradar.com/mcp` no longer answers. Deleting the Worker afterwards is optional.

`OAUTH_KV` and the Supabase rows are inert without the route and can be left. Connector API keys
already minted stay live until revoked in Settings — they are ordinary keys, and the route going
away does not revoke them.
