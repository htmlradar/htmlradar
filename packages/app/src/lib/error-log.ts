import 'server-only';

export interface LogOpts {
  source: string;
  message: string;
  userId?: string | null;
  route?: string | null;
  context?: Record<string, unknown>;
  level?: 'error' | 'warn' | 'info';
}

// Server-side error sink. Two destinations: console.error (visible in
// `wrangler pages deployment tail`) and the app_error_log table
// (queryable via SQL after the fact). Never throws — failure to log
// must not break the request path.
export async function logServerError(opts: LogOpts): Promise<void> {
  const level = opts.level ?? 'error';
  const ctx = opts.context ?? {};
  // eslint-disable-next-line no-console
  console.error(
    `[${opts.source}] ${level}: ${opts.message}`,
    JSON.stringify({ userId: opts.userId, route: opts.route, ...ctx }),
  );

  const supabaseUrl = process.env['SUPABASE_URL'] ?? '';
  const serviceRole = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
  if (!supabaseUrl || !serviceRole) return;

  try {
    await fetch(`${supabaseUrl}/rest/v1/app_error_log`, {
      method: 'POST',
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        source: opts.source,
        level,
        message: opts.message,
        user_id: opts.userId ?? null,
        route: opts.route ?? null,
        context: ctx,
      }),
    });
  } catch {
    // Swallow — already logged to console above.
  }
}
