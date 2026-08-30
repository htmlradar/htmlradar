// Worker environment. Secrets are set via `wrangler secret put`;
// non-secret vars come from wrangler.toml. R2 bucket is a binding, not a
// fetched resource — Cloudflare wires it at request time.

export interface Env {
  // Secrets
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  SESSION_SECRET: string;

  // Vars
  // Upstream the tracker bundle is fetched from. Recipient documents load it
  // from their own host (see TRACKER_PATH in index.ts); this is where the
  // worker gets it.
  TRACKER_URL: string;
  // Host that serves recipient documents. Recipient HTML gets a registrable
  // domain of its own so it never shares an origin — or a reputation — with
  // the application. Defaults to htmlradar.page; self-hosters set their own
  // in wrangler.toml.
  SHARE_HOST?: string;
  // Comma-separated hosts that used to serve /r/ and now only redirect there.
  // Defaults to htmlradar.com. Empty for a self-hoster who never moved.
  LEGACY_HOSTS?: string;
  // Git commit bound at deploy time (`wrangler deploy --var GIT_SHA:...` from
  // .github/workflows/deploy.yml); absent under `wrangler dev` and in tests.
  GIT_SHA?: string;

  // Bindings
  DOCS_BUCKET: R2Bucket;
}
