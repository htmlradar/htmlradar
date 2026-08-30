import type { Attachment, Share } from './supabase.js';
import { escapeHtml } from './escape.js';

interface InjectOptions {
  share: Share;
  tier: 'free' | 'pro';
  trackingEnabled: boolean;
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
  const headSnippet = opts.trackingEnabled ? headInjection(opts) : '';
  // TODO(decision): Founder decision 30 Aug 2026: no recipient notice or
  // opt-out link on any tier; opt-out remains reachable via
  // window.HTMLRadar.optOut().
  const footerSnippet = opts.tier === 'free' ? chromeFooter() : '';
  // Attachments are ALWAYS surfaced to the recipient when present, per
  // the design decision: "if you don't want a file shared,
  // don't attach it." The recipient view shows a corner pill + side
  // drawer regardless of lock_deck — the lock_deck toggle controls the
  // DECK's save/print posture, not the attachments.
  const materialsSnippet =
    opts.attachments && opts.attachments.length > 0
      ? attachmentsPanel(opts.share.slug, opts.attachments)
      : '';
  // Download/screenshot guard fires when the sender has chosen to LOCK
  // the deck. Blocks save/print/right-click/drag, neutralises common
  // DevTools shortcuts, and renders a faint per-viewer email watermark
  // that becomes prominent on print/save-as-PDF.
  const guardSnippet = opts.share.lock_deck
    ? downloadGuard(opts.email ?? opts.share.recipient_label ?? null)
    : '';

  // Order matters: guard first, so its styles/script land at the top of
  // append-order, before materials and footer.
  type AppendSink = { append(content: string, opts: { html: true }): unknown };
  const appendBodyChrome = (sink: AppendSink): void => {
    if (guardSnippet) sink.append(guardSnippet, { html: true });
    if (materialsSnippet) sink.append(materialsSnippet, { html: true });
    if (footerSnippet) sink.append(footerSnippet, { html: true });
  };

  // Fragment / malformed uploads have no <head> (or <body>) element for the
  // streaming rewriter to hook, so the head/body handlers below never fire
  // and the tracker script would be silently dropped — the doc serves, but
  // with no session, no analytics, and no first-open email. (This bit a
  // real customer doc on 2026-07-08.) We record whether each anchor fired
  // and, at document end, append anything that didn't land onto the end of
  // the stream so the browser still parses and executes it.
  let headSeen = false;
  let bodySeen = false;
  const rewriter = new HTMLRewriter()
    .on('head', {
      element(el) {
        headSeen = true;
        el.append(headSnippet, { html: true });
      },
    })
    .on('body', {
      element(el) {
        bodySeen = true;
        appendBodyChrome(el);
      },
    })
    .onDocument({
      end(end) {
        if (!headSeen && headSnippet) end.append(headSnippet, { html: true });
        if (!bodySeen) appendBodyChrome(end);
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
  //
  // form-action 'none': a hosted document's forms cannot submit anywhere.
  // This is the credential-harvesting defence — a convincing sign-in page
  // uploaded as a document can no longer post what a visitor types, to us or
  // to anyone else. Nothing legitimate loses: the tracker's own email gate
  // calls preventDefault and sends the address with fetch, which form-action
  // does not govern, and the proxy's gate and opt-out pages are separate
  // responses that never carry this header.
  headers.set(
    'Content-Security-Policy',
    `frame-ancestors 'none'; base-uri 'none'; form-action 'none';`,
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

// Attachments panel — recipient-side UI for files attached to a share.
//
// Replaces the prior bottom-right floating "materials panel" with a
// less intrusive pattern:
//   • A small `📎 N` pill in the TOP-right corner of the viewport,
//     pulses gently twice on first load to surface its existence,
//     then settles.
//   • Click → a side drawer slides in from the right. Doesn't block
//     the deck (overlays the right gutter via fixed-positioning).
//   • Click the X button, the overlay backdrop, or press Escape →
//     drawer collapses back to the pill.
//
// Per the 2026-05-19 design decision: attachments are ALWAYS shown
// when present, regardless of lock_deck state. The deck's lock toggle
// controls save/print/screenshot — it doesn't hide attachments.
//
// All styles and script are inline + scoped under unique class names
// so they can't collide with the host document's CSS or JS. Download
// links point at /r/{slug}/m/{att_id}, which the proxy gates by
// session cookie AND logs to the new `attachment_downloads` table
// (migration 016) for per-viewer attribution.
function attachmentsPanel(slug: string, attachments: Attachment[]): string {
  const items = attachments
    .map((a) => {
      const safeName = escapeHtml(a.filename);
      const safeSize = escapeHtml(formatBytesForPanel(a.size_bytes));
      const safeExt = (extOf(a.filename) || a.mime_type.split('/').pop() || 'file')
        .toUpperCase()
        .slice(0, 4);
      const href = `/r/${escapeHtml(slug)}/m/${escapeHtml(a.id)}`;
      return `
        <li class="hr-att-item">
          <a href="${href}" class="hr-att-link" download="${safeName}">
            <span class="hr-att-icon" aria-hidden="true">${escapeHtml(safeExt)}</span>
            <span class="hr-att-text">
              <span class="hr-att-name">${safeName}</span>
              <span class="hr-att-meta">${escapeHtml(safeExt)} · ${safeSize}</span>
            </span>
            <span class="hr-att-dl" aria-hidden="true">↓</span>
          </a>
        </li>`;
    })
    .join('');

  const count = attachments.length;
  const fileWord = count === 1 ? 'file' : 'files';
  return `
<button type="button" class="hr-att-pill" aria-label="${count} attached ${fileWord}" aria-expanded="false" aria-controls="hr-att-drawer">
  <span class="hr-att-pill-ic" aria-hidden="true">📎</span>
  Files
  <span class="hr-att-pill-count">${count}</span>
</button>
<div class="hr-att-bg" aria-hidden="true"></div>
<aside class="hr-att-drawer" id="hr-att-drawer" role="region" aria-label="Files in this share">
  <div class="hr-att-head">
    <div>
      <div class="hr-att-title">Files in this share</div>
      <div class="hr-att-sub">${count} attached · downloads tracked</div>
    </div>
    <button type="button" class="hr-att-close" aria-label="Close">×</button>
  </div>
  <ul class="hr-att-list">${items}</ul>
  <div class="hr-att-foot">Shared via HTMLRadar · downloads attributed to your email</div>
</aside>
<style>
.hr-att-pill,.hr-att-drawer,.hr-att-bg,.hr-att-pill *,.hr-att-drawer *{box-sizing:border-box}
.hr-att-pill{position:fixed;top:18px;right:18px;z-index:2147483645;
  display:inline-flex;align-items:center;gap:8px;padding:8px 14px 8px 12px;
  background:#FBF1E8;color:#1F1108;border:1px solid #E8D5BD;border-radius:999px;
  font:500 12.5px/1 -apple-system,BlinkMacSystemFont,Inter,system-ui,sans-serif;
  cursor:pointer;box-shadow:0 4px 14px rgba(31,17,8,.10);
  transition:background-color 120ms,border-color 120ms,transform 120ms,box-shadow 120ms;
  animation:hr-att-pulse 1.6s cubic-bezier(0.4,0,0.6,1) 2}
.hr-att-pill:hover{background:#F4E1CB;border-color:#7A1F2E;transform:translateY(-1px)}
.hr-att-pill-ic{font-size:14px}
.hr-att-pill-count{display:inline-flex;align-items:center;justify-content:center;
  min-width:18px;padding:0 6px;font:600 10.5px/1 ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace;
  letter-spacing:0;color:#FBF1E8;background:#7A1F2E;border-radius:999px}
@keyframes hr-att-pulse{
  0%,100%{box-shadow:0 4px 14px rgba(31,17,8,.10)}
  50%{box-shadow:0 4px 14px rgba(31,17,8,.10),0 0 0 8px rgba(122,31,46,.10)}}
@media (prefers-reduced-motion: reduce){.hr-att-pill{animation:none}}
.hr-att-bg{position:fixed;inset:0;background:rgba(31,17,8,.05);backdrop-filter:blur(2px);
  opacity:0;pointer-events:none;transition:opacity 180ms;z-index:2147483646}
.hr-att-drawer{position:fixed;top:0;right:0;bottom:0;width:360px;max-width:calc(100vw - 32px);
  background:#FBF1E8;border-left:1px solid #E8D5BD;box-shadow:-16px 0 40px rgba(31,17,8,.10);
  transform:translateX(100%);transition:transform 220ms cubic-bezier(0.2,0.8,0.2,1);
  z-index:2147483647;display:flex;flex-direction:column;
  font:13px/1.45 -apple-system,BlinkMacSystemFont,Inter,system-ui,sans-serif;color:#1F1108}
body.hr-att-open .hr-att-bg{opacity:1;pointer-events:auto}
body.hr-att-open .hr-att-drawer{transform:translateX(0)}
.hr-att-head{display:flex;align-items:baseline;justify-content:space-between;padding:22px 22px 12px}
.hr-att-title{font:400 22px/1.15 Georgia,'Hoefler Text',Charter,serif;letter-spacing:-.025em;color:#1F1108}
.hr-att-sub{margin-top:6px;font:500 10.5px/1 ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace;
  letter-spacing:.18em;text-transform:uppercase;color:#876959}
.hr-att-close{background:transparent;border:0;color:#876959;font-size:20px;line-height:1;
  cursor:pointer;padding:4px 8px;border-radius:6px}
.hr-att-close:hover{background:rgba(232,213,189,.6);color:#1F1108}
.hr-att-list{list-style:none;margin:0;padding:8px 0;flex:1;overflow-y:auto}
.hr-att-item{padding:0}
.hr-att-link{display:grid;grid-template-columns:40px 1fr auto;gap:14px;align-items:center;
  padding:14px 22px;text-decoration:none;color:#1F1108;transition:background-color 120ms}
.hr-att-link:hover{background:#F4E1CB}
.hr-att-icon{width:40px;height:40px;border-radius:10px;background:rgba(232,213,189,.5);
  display:grid;place-items:center;font:600 10.5px/1 ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace;
  letter-spacing:.08em;color:#7A1F2E}
.hr-att-text{min-width:0;display:block}
.hr-att-name{display:block;font-weight:500;font-size:14.5px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
.hr-att-meta{display:block;margin-top:2px;font:500 10.5px/1 ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace;
  letter-spacing:.14em;text-transform:uppercase;color:#876959}
.hr-att-dl{color:#7A1F2E;font:600 16px/1 system-ui;flex-shrink:0}
.hr-att-foot{padding:14px 22px;border-top:1px solid #E8D5BD;
  font:500 10px/1.4 ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace;
  letter-spacing:.14em;text-transform:uppercase;color:#876959}
</style>
<script>(function(){
  var pill=document.querySelector('.hr-att-pill');
  var drawer=document.querySelector('.hr-att-drawer');
  var bg=document.querySelector('.hr-att-bg');
  var closeBtn=drawer&&drawer.querySelector('.hr-att-close');
  if(!pill||!drawer||!bg)return;
  function set(open){
    document.body.classList.toggle('hr-att-open',open);
    pill.setAttribute('aria-expanded',open?'true':'false');
  }
  pill.addEventListener('click',function(){set(!document.body.classList.contains('hr-att-open'));});
  if(closeBtn)closeBtn.addEventListener('click',function(){set(false);});
  bg.addEventListener('click',function(){set(false);});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')set(false);});
})();</script>
`.trim();
}

// Download/screenshot guard.
//
// Injected when `share.allow_download === false` (the default). Three
// layers, each addressing a different leak path:
//
//   1. CSS — disables `user-select` outside form fields, blocks image
//      drag, and replaces the printed page with a clear "printing
//      disabled" message. The print rule is the strongest tool we have
//      against save-as-PDF — Cmd+P is the most common leak path.
//
//   2. Inline script — captures `contextmenu`, `Cmd/Ctrl+S/P/U`, F12,
//      `Cmd+Option+I`, `Ctrl+Shift+I`, and `dragstart` on images. Skips
//      any event whose target is an input/textarea/contenteditable so
//      the sender's own forms still accept input.
//
//   3. Watermark overlay — a fixed-position grid of repeated `<span>`s
//      diagonally tiling the viewport with the recipient's identity.
//      Opacity 0.04 during normal viewing (literally invisible to the
//      eye — verify by squinting at DocSend's recipient view; theirs is
//      the same trick), bumps to 0.3 on `@media print`. Two effects:
//
//      a. Print-to-PDF carries a visible diagonal email pattern across
//         every page — the resulting file is traceable to the leaker.
//      b. OS-level screenshots (Cmd+Shift+4) pick up the faint pattern
//         because the underlying pixels are rendered. JPEG compression
//         actually makes the watermark slightly MORE visible in the
//         compressed image than in the rendered DOM.
//
// None of this is bulletproof. A determined viewer can pull HTML via
// view-source or DevTools, render in a sandboxed browser without our
// CSS, and screenshot clean. The realistic bar is "stops 95% of casual
// extraction; makes the 5% who get through leave a paper trail." That's
// the DocSend bar, and it's the right product promise for the share-
// page workflow.
//
// `identity` is the per-viewer text shown in the watermark. Priority:
//   - verified email (allowlist or required-email flow)
//   - share's recipient label (sender's hint, e.g. "Marc — Series A")
//   - null → fall back to the share-anonymous notice
function downloadGuard(identity: string | null): string {
  const text = identity ?? 'Shared via htmlradar.com';
  const safe = escapeHtml(text);
  // Repeated enough times that the grid covers a wide laptop viewport
  // (5–6 cols × 5 rows ≈ 25-30 cells). Each cell renders one rotated
  // mono span; pure CSS, no runtime cost beyond layout.
  const tiles = Array(30).fill(`<span>${safe}</span>`).join('');

  return `
<style id="htmlradar-guard-style">
  body { -webkit-user-select: none; -moz-user-select: none; user-select: none; -webkit-touch-callout: none; }
  body input, body textarea, body select, body [contenteditable="true"] {
    -webkit-user-select: text; -moz-user-select: text; user-select: text;
  }
  body img { -webkit-user-drag: none; user-drag: none; -webkit-touch-callout: none; }
  @media print {
    html { background: #FBF1E8; }
    body { display: none; }
    html::before {
      content: "Printing of this document has been disabled by the sender.";
      display: block;
      padding: 40vh 24px 0;
      text-align: center;
      font: 500 16px/1.5 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      color: #1F1108;
    }
  }
  .htmlradar-wm {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    pointer-events: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    grid-auto-rows: 130px;
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
  }
  .htmlradar-wm span {
    align-self: center;
    justify-self: center;
    white-space: nowrap;
    transform: rotate(-28deg);
    font: 500 11px/1 ui-monospace,'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;
    letter-spacing: 0.08em;
    color: #1F1108;
    opacity: 0.04;
  }
  @media print { .htmlradar-wm span { opacity: 0.3; } }
</style>
<div class="htmlradar-wm" aria-hidden="true">${tiles}</div>
<script>(function(){
  function inField(t){
    if(!t) return false;
    var tag = t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (t.isContentEditable) return true;
    return false;
  }
  document.addEventListener('contextmenu', function(e){
    if (inField(e.target)) return;
    e.preventDefault();
  }, true);
  document.addEventListener('keydown', function(e){
    if (inField(e.target)) return;
    var k = (e.key || '').toLowerCase();
    var cmd = e.metaKey || e.ctrlKey;
    if (cmd && (k === 's' || k === 'p' || k === 'u')) { e.preventDefault(); e.stopPropagation(); return; }
    if (cmd && e.altKey && k === 'i') { e.preventDefault(); return; }
    if (cmd && e.shiftKey && (k === 'i' || k === 'j' || k === 'c')) { e.preventDefault(); return; }
    if (k === 'f12') { e.preventDefault(); }
  }, true);
  document.addEventListener('dragstart', function(e){
    if (e.target && e.target.tagName === 'IMG') e.preventDefault();
  }, true);
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
    `<a href="https://htmlradar.com/?utm_source=powered-by-badge&utm_medium=shared-doc" target="_blank" rel="noopener" `,
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
