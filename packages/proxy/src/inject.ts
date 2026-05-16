import type { Attachment, Share } from './supabase.js';
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
  // Supporting materials to surface inside the rendered doc. Only
  // populated when the share has `allow_download = true`. When empty
  // or undefined the materials panel is NOT injected — recipients have
  // no signal that attachments exist.
  attachments?: Attachment[];
}

// Injects the tracker config + script tag into <head>, and (for free tier)
// a chrome footer before </body>. The document body is never modified.

export function injectTracker(html: Response, opts: InjectOptions): Response {
  const headSnippet = headInjection(opts);
  const footerSnippet = opts.tier === 'free' ? chromeFooter() : '';
  const materialsSnippet =
    opts.share.allow_download && opts.attachments && opts.attachments.length > 0
      ? materialsPanel(opts.share.slug, opts.attachments)
      : '';

  const rewriter = new HTMLRewriter()
    .on('head', {
      element(el) {
        el.append(headSnippet, { html: true });
      },
    })
    .on('body', {
      element(el) {
        if (materialsSnippet) el.append(materialsSnippet, { html: true });
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

// Supporting-materials panel. Injected before </body> when the share has
// allow_download = true AND attachments exist. Renders as a compact
// pinned button at the bottom-right of the viewport that expands to a
// file list with Download links.
//
// All styles are inline + scoped under unique class names so they can't
// collide with the host document's CSS. The toggle uses a tiny inline
// script (no external deps). The download links point at the proxy's
// /r/{slug}/m/{att_id} route — every click cookie-gated + logged.
function materialsPanel(slug: string, attachments: Attachment[]): string {
  const items = attachments
    .map((a) => {
      const safeName = escapeHtml(a.filename);
      const safeKb = formatBytesForPanel(a.size_bytes);
      const safeExt = (extOf(a.filename) || a.mime_type.split('/').pop() || 'file').toUpperCase();
      const href = `/r/${escapeHtml(slug)}/m/${escapeHtml(a.id)}`;
      return `
        <li class="htmlradar-mat-item">
          <span class="htmlradar-mat-meta">${escapeHtml(safeExt)} · ${escapeHtml(safeKb)}</span>
          <a href="${href}" class="htmlradar-mat-link" download="${safeName}">
            <span class="htmlradar-mat-name">${safeName}</span>
            <span class="htmlradar-mat-dl" aria-hidden="true">↓</span>
          </a>
        </li>`;
    })
    .join('');

  const count = attachments.length;
  return `
<div class="htmlradar-mat-root" data-state="collapsed">
  <button type="button" class="htmlradar-mat-toggle" aria-expanded="false" aria-controls="htmlradar-mat-list">
    <span class="htmlradar-mat-toggle-icon" aria-hidden="true">📎</span>
    Materials
    <span class="htmlradar-mat-toggle-count">${count}</span>
  </button>
  <div class="htmlradar-mat-panel" id="htmlradar-mat-list" role="region" aria-label="Supporting materials">
    <div class="htmlradar-mat-header">
      <span>Supporting materials</span>
      <button type="button" class="htmlradar-mat-close" aria-label="Close materials">×</button>
    </div>
    <ul class="htmlradar-mat-list">
      ${items}
    </ul>
    <div class="htmlradar-mat-footer">Shared via HTMLRadar · every download tracked</div>
  </div>
</div>
<style>
.htmlradar-mat-root{position:fixed;right:16px;bottom:48px;z-index:2147483645;
  font:13px/1.45 -apple-system,BlinkMacSystemFont,Inter,system-ui,sans-serif;
  color:#1F1108}
.htmlradar-mat-root *{box-sizing:border-box}
.htmlradar-mat-toggle{display:inline-flex;align-items:center;gap:8px;
  background:#FBF1E8;color:#1F1108;border:1px solid #E8D5BD;border-radius:999px;
  padding:8px 14px;font:inherit;cursor:pointer;box-shadow:0 2px 8px rgba(31,17,8,.08);
  transition:background-color 120ms ease,border-color 120ms ease}
.htmlradar-mat-toggle:hover{background:#F4E1CB;border-color:#7A1F2E}
.htmlradar-mat-toggle-icon{font-size:14px}
.htmlradar-mat-toggle-count{display:inline-flex;align-items:center;justify-content:center;
  min-width:18px;padding:0 6px;font:500 10px/1 ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace;
  color:#FBF1E8;background:#7A1F2E;border-radius:999px}
.htmlradar-mat-panel{display:none;margin-top:10px;width:min(360px,calc(100vw - 32px));
  background:#FBF1E8;border:1px solid #E8D5BD;border-radius:14px;
  box-shadow:0 8px 32px rgba(31,17,8,.12);overflow:hidden}
.htmlradar-mat-root[data-state="open"] .htmlradar-mat-panel{display:block}
.htmlradar-mat-header{display:flex;align-items:center;justify-content:space-between;
  padding:14px 16px 10px;font:500 11px/1 ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace;
  text-transform:uppercase;letter-spacing:.16em;color:#876959;border-bottom:1px solid #E8D5BD}
.htmlradar-mat-close{background:transparent;border:0;color:#876959;font-size:18px;line-height:1;
  cursor:pointer;padding:0 4px}
.htmlradar-mat-close:hover{color:#5A1521}
.htmlradar-mat-list{list-style:none;margin:0;padding:6px 0;max-height:min(420px,60vh);overflow:auto}
.htmlradar-mat-item{padding:0}
.htmlradar-mat-link{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:10px 16px;text-decoration:none;color:#1F1108;transition:background-color 120ms ease}
.htmlradar-mat-link:hover{background:#F4E1CB}
.htmlradar-mat-name{display:block;font-weight:500;font-size:13.5px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px}
.htmlradar-mat-meta{display:block;padding:4px 16px 0;font:500 10px/1 ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace;
  text-transform:uppercase;letter-spacing:.14em;color:#876959}
.htmlradar-mat-dl{color:#7A1F2E;font:500 16px/1 system-ui}
.htmlradar-mat-footer{padding:10px 16px;font:500 10px/1.4 ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace;
  text-transform:uppercase;letter-spacing:.14em;color:#876959;border-top:1px solid #E8D5BD}
@media (prefers-reduced-motion: reduce){.htmlradar-mat-toggle,.htmlradar-mat-link{transition:none}}
</style>
<script>(function(){
  var root=document.currentScript&&document.currentScript.previousElementSibling;
  // currentScript may not be reachable in all renderers — fall back to
  // a queryselector. The class name is unique enough to be safe.
  if(!root||!root.classList||!root.classList.contains('htmlradar-mat-root')){
    root=document.querySelector('.htmlradar-mat-root');
  }
  if(!root)return;
  var toggle=root.querySelector('.htmlradar-mat-toggle');
  var closeBtn=root.querySelector('.htmlradar-mat-close');
  function set(state){
    root.setAttribute('data-state',state);
    if(toggle)toggle.setAttribute('aria-expanded',state==='open'?'true':'false');
  }
  if(toggle)toggle.addEventListener('click',function(){
    set(root.getAttribute('data-state')==='open'?'collapsed':'open');
  });
  if(closeBtn)closeBtn.addEventListener('click',function(){set('collapsed');});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')set('collapsed');});
})();</script>
`.trim();
}

function formatBytesForPanel(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

// Free-tier "Powered by HTMLRadar" credit baked into the recipient view.
//
// Visual register is deliberately quiet:
//   - bottom-right corner (out of the reading path)
//   - small typographic mark, no big colour block
//   - translucent cream chip so it sits on top of any sender background
//     (dark or light) without screaming
//
// The big solid pill is reserved for surfaces HTMLRadar OWNS (the gate,
// the error pages — see proxy/src/responses.ts). On the viewed doc the
// sender's content is the canvas; the brand is a credit, not a billboard.
//
// Removing this badge is the Pro tier's value prop — see
// injectTracker(opts.tier) and the pricing page's "No footer" bullet.
function chromeFooter(): string {
  return [
    `<a href="https://htmlradar.com" target="_blank" rel="noopener" `,
    `style="position:fixed;bottom:10px;right:12px;z-index:2147483646;`,
    `display:inline-flex;align-items:center;gap:6px;`,
    `background:rgba(251,241,232,0.92);color:#3A2818;text-decoration:none;`,
    `font:500 10.5px/1 ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace;`,
    `letter-spacing:0.04em;`,
    `padding:5px 9px 5px 7px;border-radius:6px;`,
    `border:1px solid rgba(135,105,89,0.25);`,
    `box-shadow:0 1px 2px rgba(31,17,8,0.06);backdrop-filter:blur(6px);">`,
    `<svg aria-hidden viewBox="0 0 24 24" width="11" height="11" style="vertical-align:-1px;flex:0 0 auto;">`,
    `<circle cx="12" cy="12" r="9" fill="none" stroke="#7A1F2E" stroke-width="1.6" opacity="0.55"/>`,
    `<line x1="12" y1="12" x2="12" y2="3" stroke="#7A1F2E" stroke-width="1.8" stroke-linecap="round"/>`,
    `<circle cx="12" cy="12" r="1.8" fill="#7A1F2E"/>`,
    `</svg>`,
    `<span>Powered by <span style="color:#7A1F2E;">HTMLRadar</span></span>`,
    `</a>`,
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
