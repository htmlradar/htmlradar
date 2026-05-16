// Owner-preview token issuance for the "Preview as you" flow.
//
// Mirrors the proxy's verifyOwnerPreviewToken (packages/proxy/src/auth.ts)
// — same HMAC message format and same secret. The proxy is the source
// of truth for verification; this file only mints. If the formats ever
// diverge, the proxy's implementation wins and this file must be brought
// back in sync.
//
// Why duplicate instead of share: the proxy is a Cloudflare Worker bundle
// (no shared imports from packages/app), and the app's Edge runtime has
// the same WebCrypto API as the Worker — so we re-implement the few
// lines rather than introduce a fourth workspace package just for
// crypto primitives.

const OWNER_PREVIEW_TTL_SECONDS = 10 * 60;
const OWNER_DOC_PREVIEW_TTL_SECONDS = 10 * 60;

export async function issueOwnerPreviewToken(slug: string, secret: string): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + OWNER_PREVIEW_TTL_SECONDS;
  const mac = await hmac(`owner-preview:${slug}:${expiresAt}`, secret);
  return `${slug}.${expiresAt}.${mac}`;
}

// Mirror of the proxy's verifyOwnerDocPreviewToken — used by the
// previewDocumentAction server action to mint a token bound to a
// document_id (NOT a share slug). Lets the doc owner preview their
// raw uploaded HTML before any share exists.
export async function issueOwnerDocPreviewToken(docId: string, secret: string): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + OWNER_DOC_PREVIEW_TTL_SECONDS;
  const mac = await hmac(`owner-doc-preview:${docId}:${expiresAt}`, secret);
  return `${docId}.${expiresAt}.${mac}`;
}

async function hmac(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return base64urlEncode(new Uint8Array(sig));
}

function base64urlEncode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
