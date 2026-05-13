import { escapeHtml } from './escape.js';

// Pre-rendered HTML responses for error states and the password gate.
// Kept inline so the worker is single-file deployable.

const SHELL = (title: string, body: string, status: number): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — HTMLRadar</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
    background:#faf7f1; color:#1c1814; padding:24px; }
  .card { background:#fff; border:1px solid #ddd4c2; border-radius:12px; padding:32px;
    max-width:420px; width:100%;
    box-shadow:0 4px 16px rgba(0,0,0,0.04); }
  h1 { margin:0 0 8px; font-size:20px; letter-spacing:-0.01em; }
  p { margin:0 0 16px; color:#6b6258; font-size:15px; line-height:1.55; }
  .footer { font-family:'JetBrains Mono','SF Mono',Menlo,monospace; font-size:11px;
    color:#9b9285; margin-top:20px; padding-top:16px; border-top:1px solid #e8e1d2; }
  .footer a { color:inherit; text-decoration:none; border-bottom:1px dotted currentColor; }
  input, button { font:inherit; }
  input { width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #ddd4c2; border-radius:6px;
    margin-bottom:12px; }
  input:focus { outline:none; border-color:#1a8870; }
  button { width:100%; padding:11px 16px; background:#1a8870; color:#fff; border:none; border-radius:6px;
    font-weight:500; cursor:pointer; }
  button:hover { opacity:0.92; }
  .error { color:#b35314; font-size:13px; margin-top:-6px; margin-bottom:12px; min-height:18px; }
</style></head>
<body><div class="card">${body}<div class="footer">via <a href="https://htmlradar.com">HTMLRadar</a></div></div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

export const notFound = (): Response =>
  SHELL(
    'Not found',
    `<h1>This share isn't available.</h1>
     <p>The link may have been deleted or never existed.</p>`,
    404,
  );

export const revoked = (): Response =>
  SHELL(
    'Access revoked',
    `<h1>This link has been revoked.</h1>
     <p>The sender removed access to this document. Contact them for a new link.</p>`,
    403,
  );

export const expired = (): Response =>
  SHELL(
    'Link expired',
    `<h1>This link has expired.</h1>
     <p>The sender set this link to expire. Contact them for a new link.</p>`,
    410,
  );

export const sourceUnreachable = (): Response =>
  SHELL(
    'Document unreachable',
    `<h1>We couldn't load this document.</h1>
     <p>The source URL didn't respond. The sender has been notified.</p>`,
    502,
  );

export const passwordForm = (slug: string, error?: string): Response =>
  SHELL(
    'Enter password',
    `<h1>This document is password-protected.</h1>
     <p>Enter the password the sender shared with you.</p>
     <form method="POST" action="/r/${escapeHtml(slug)}/auth">
       <input type="password" name="password" placeholder="Password" autocomplete="current-password" required autofocus />
       <div class="error">${error ? escapeHtml(error) : ''}</div>
       <button type="submit">Continue</button>
     </form>`,
    error ? 401 : 200,
  );

export const emailGateForm = (slug: string, error?: string): Response =>
  SHELL(
    'Enter your email',
    `<h1>View this document.</h1>
     <p>Enter your email to continue. The sender will see who opened it.</p>
     <form method="POST" action="/r/${escapeHtml(slug)}/email">
       <input type="email" name="email" placeholder="you@example.com" required autofocus autocomplete="email" />
       <div class="error">${error ? escapeHtml(error) : ''}</div>
       <button type="submit">Continue</button>
     </form>`,
    error ? 401 : 200,
  );
