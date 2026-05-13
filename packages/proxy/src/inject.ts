import type { Share } from './supabase.js';
import { escapeHtml } from './escape.js';

interface InjectOptions {
  share: Share;
  tier: 'free' | 'pro';
  trackerUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  email?: string;
  geo?: {
    country?: string;
    city?: string;
    deviceType?: string;
    os?: string;
    browser?: string;
  };
}

// Injects the tracker config + script tag into <head>, and (for free tier)
// a chrome footer before </body>. The document body is never modified.

export function injectTracker(html: Response, opts: InjectOptions): Response {
  const headSnippet = headInjection(opts);
  const footerSnippet = opts.tier === 'free' ? chromeFooter() : '';

  const rewriter = new HTMLRewriter()
    .on('head', {
      element(el) {
        el.append(headSnippet, { html: true });
      },
    })
    .on('body', {
      element(el) {
        if (footerSnippet) el.append(footerSnippet, { html: true });
      },
    });

  const out = rewriter.transform(html);
  const headers = new Headers(out.headers);
  headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  // Minimal CSP. Customer HTML may contain arbitrary inline scripts/styles,
  // so we can't lock script-src. We do constrain framing, base-uri, and
  // form-action to limit the blast radius of malicious docs.
  headers.set(
    'Content-Security-Policy',
    `frame-ancestors 'none'; base-uri 'none'; form-action 'self' ${new URL(opts.supabaseUrl).origin};`,
  );
  return new Response(out.body, { status: out.status, headers });
}

function headInjection(opts: InjectOptions): string {
  const privacyMode = opts.share.require_email ? 'email-gated' : 'anonymous';
  const config: Record<string, unknown> = {
    privacy: { mode: privacyMode },
    gate: { enabled: opts.share.require_email && !opts.email },
  };
  if (opts.email) config['email'] = opts.email;
  if (opts.geo) config['geo'] = opts.geo;

  // <script>-context safety: JSON encoding may produce a literal `</script>`
  // sequence if a value ever contained one. None of ours can today, but
  // armor the encoding so future config additions don't tee up a bug.
  const safeJson = JSON.stringify(config).replace(/<\/script/gi, '<\\/script');

  return [
    `<script>window.HTMLRadarConfig=${safeJson};</script>`,
    `<script src="${escapeHtml(opts.trackerUrl)}"`,
    ` data-supabase-url="${escapeHtml(opts.supabaseUrl)}"`,
    ` data-supabase-anon-key="${escapeHtml(opts.supabaseAnonKey)}"`,
    ` data-share-slug="${escapeHtml(opts.share.slug)}"`,
    ` defer></script>`,
  ].join('');
}

function chromeFooter(): string {
  return [
    `<div style="position:fixed;bottom:8px;right:12px;z-index:2147483646;`,
    `font:11px/1.4 'JetBrains Mono','SF Mono',Menlo,monospace;color:#6b6258;`,
    `background:rgba(250,247,241,0.92);padding:4px 10px;border-radius:4px;`,
    `border:1px solid #ddd4c2;backdrop-filter:blur(8px);">`,
    `Shared with `,
    `<a href="https://htmlradar.com" target="_blank" rel="noopener" `,
    `style="color:#0f5e4d;text-decoration:none;border-bottom:1px dotted currentColor;">HTMLRadar</a>`,
    `</div>`,
  ].join('');
}

export function geoFromRequest(request: Request): InjectOptions['geo'] {
  const cf = (request as { cf?: Record<string, unknown> }).cf;
  const ua = request.headers.get('user-agent') ?? '';
  const country = typeof cf?.['country'] === 'string' ? (cf['country'] as string) : undefined;
  const city = typeof cf?.['city'] === 'string' ? (cf['city'] as string) : undefined;
  return {
    ...(country ? { country } : {}),
    ...(city ? { city } : {}),
    ...parseUserAgent(ua),
  };
}

// Lean UA parser — buckets only. We don't need browser version strings;
// dashboards want "Mobile · iOS · Safari" not "Mozilla/5.0 (iPhone; CPU iPhone OS…)".
function parseUserAgent(ua: string): {
  deviceType?: string;
  os?: string;
  browser?: string;
} {
  if (!ua) return {};
  const out: { deviceType?: string; os?: string; browser?: string } = {};
  out.deviceType = /Mobile|Android.*(?!Tablet)|iPhone/i.test(ua)
    ? 'mobile'
    : /iPad|Tablet/i.test(ua)
      ? 'tablet'
      : 'desktop';
  if (/Windows/i.test(ua)) out.os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) out.os = 'macOS';
  else if (/iPhone|iPad|iOS/i.test(ua)) out.os = 'iOS';
  else if (/Android/i.test(ua)) out.os = 'Android';
  else if (/Linux/i.test(ua)) out.os = 'Linux';
  if (/Edg\//i.test(ua)) out.browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) out.browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) out.browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) out.browser = 'Safari';
  return out;
}
