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
  TRACKER_URL: string;

  // Bindings
  DOCS_BUCKET: R2Bucket;
}
