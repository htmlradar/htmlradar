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
  // The trust layer's one gate setting
  // (docs/workstreams/content-domain/TRUST-LAYER-DESIGN-2026-08-31.md).
  // Three states:
  //   ""   off. /r/{slug} serves the document exactly as it does today, and
  //        the wrapper's frame and print routes are not-found.
  //   list a comma-separated list of slugs, for QA shares only.
  //   "*"  every share.
  // Rolling back is this setting and one deploy; no database change either
  // way, and no already-sent link changes its address in any state.
  TRUST_WRAPPER?: string;
  // The trust layer's OTHER gate: handle links (Gate 2 in the design's
  // "Migration order, gates, and rollback").
  //
  // ONE SETTING REACHES BOTH HALVES, which is Sol's ninth finding. This line
  // in wrangler.toml is what wrangler hands the Worker, and the deploy
  // workflow's preflight reads the same line into NEXT_PUBLIC_TRUST_HANDLES
  // for the application build. The Worker half gates the apex-to-handle
  // redirect; the application half gates allocating a handle and stamping it
  // on new shares. They cannot disagree, so newly generated handle links and
  // the redirects that serve them switch off together.
  //
  // Two states: "" or unset is off, "*" is on. Off, a share that already
  // stores a hostname is served in place on the apex instead of redirected —
  // it still opens, and its handle-host address still works, because the
  // stored-hostname rules that serve it are NOT gated. Only the redirect is.
  TRUST_HANDLES?: string;
  // Git commit bound at deploy time (`wrangler deploy --var GIT_SHA:...` from
  // .github/workflows/deploy.yml); absent under `wrangler dev` and in tests.
  GIT_SHA?: string;

  // Bindings
  DOCS_BUCKET: R2Bucket;
}
