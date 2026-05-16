import { describe, expect, it } from 'vitest';
import {
  issueAuthCookie,
  issueEmailCookie,
  verifyAuthCookie,
  verifyEmailCookie,
  verifyOwnerDocPreviewToken,
} from '../src/auth.js';

// Mirror of the app-side `issueOwnerDocPreviewToken` in
// packages/app/src/lib/preview-token.ts. Re-implemented here so the
// proxy tests don't depend on the app package. If the message format
// ever diverges between these two files the proxy verifier will reject
// real tokens — this test guards that contract.
async function mintOwnerDocPreviewToken(docId: string, secret: string): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + 600;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(`owner-doc-preview:${docId}:${expiresAt}`),
  );
  const bytes = new Uint8Array(sig);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
  const mac = btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${docId}.${expiresAt}.${mac}`;
}

const SECRET = 'unit-test-secret-32-byte-long-string';

describe('auth cookies', () => {
  it('round-trips a valid cookie', async () => {
    const cookie = await issueAuthCookie('swift-falcon-a3f2', SECRET);
    const header = cookie.split('; ')[0]!;
    const verified = await verifyAuthCookie(header, 'swift-falcon-a3f2', SECRET);
    expect(verified).not.toBeNull();
    expect(verified?.slug).toBe('swift-falcon-a3f2');
  });

  it('rejects a tampered MAC', async () => {
    const cookie = await issueAuthCookie('swift-falcon-a3f2', SECRET);
    const header = cookie.split('; ')[0]!;
    const tampered = header.slice(0, -4) + 'AAAA';
    const verified = await verifyAuthCookie(tampered, 'swift-falcon-a3f2', SECRET);
    expect(verified).toBeNull();
  });

  it('rejects a cookie for a different slug', async () => {
    const cookie = await issueAuthCookie('swift-falcon-a3f2', SECRET);
    const header = cookie.split('; ')[0]!;
    const verified = await verifyAuthCookie(header, 'other-slug-1234', SECRET);
    expect(verified).toBeNull();
  });

  it('rejects when the wrong secret is used', async () => {
    const cookie = await issueAuthCookie('swift-falcon-a3f2', SECRET);
    const header = cookie.split('; ')[0]!;
    const verified = await verifyAuthCookie(header, 'swift-falcon-a3f2', 'a-different-secret');
    expect(verified).toBeNull();
  });

  it('returns null on missing cookie header', async () => {
    expect(await verifyAuthCookie(null, 'x', SECRET)).toBeNull();
    expect(await verifyAuthCookie('', 'x', SECRET)).toBeNull();
    expect(await verifyAuthCookie('htmlradar_auth_x=bad-format', 'x', SECRET)).toBeNull();
  });
});

describe('email cookies', () => {
  it('round-trips email + slug', async () => {
    const cookie = await issueEmailCookie('swift-falcon-a3f2', 'marc@example-ventures.test', SECRET);
    const verified = await verifyEmailCookie(cookie.split('; ')[0]!, 'swift-falcon-a3f2', SECRET);
    expect(verified?.email).toBe('marc@example-ventures.test');
    expect(verified?.slug).toBe('swift-falcon-a3f2');
  });

  it('rejects an email cookie tampered to swap the email', async () => {
    const cookie = await issueEmailCookie('swift-falcon-a3f2', 'marc@example-ventures.test', SECRET);
    const [name] = cookie.split('=');
    // Forge: known slug + adversary's email + same expiry + valid-looking mac
    const tampered = `${name}=swift-falcon-a3f2.bWFsbG9yeUBldmlsLmNvbQ.${Math.floor(Date.now() / 1000) + 1000}.deadbeef`;
    const verified = await verifyEmailCookie(tampered, 'swift-falcon-a3f2', SECRET);
    expect(verified).toBeNull();
  });

  it('rejects an email cookie issued under a different secret', async () => {
    const cookie = await issueEmailCookie('swift-falcon-a3f2', 'marc@example-ventures.test', SECRET);
    const verified = await verifyEmailCookie(
      cookie.split('; ')[0]!,
      'swift-falcon-a3f2',
      'a-different-secret',
    );
    expect(verified).toBeNull();
  });
});

describe('owner-doc-preview tokens', () => {
  const DOC_ID = '11111111-2222-3333-4444-555555555555';

  it('accepts a valid token', async () => {
    const token = await mintOwnerDocPreviewToken(DOC_ID, SECRET);
    expect(await verifyOwnerDocPreviewToken(token, DOC_ID, SECRET)).toBe(true);
  });

  it('rejects a token for a different doc_id', async () => {
    const token = await mintOwnerDocPreviewToken(DOC_ID, SECRET);
    expect(
      await verifyOwnerDocPreviewToken(token, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', SECRET),
    ).toBe(false);
  });

  it('rejects a token signed by a different secret', async () => {
    const token = await mintOwnerDocPreviewToken(DOC_ID, SECRET);
    expect(await verifyOwnerDocPreviewToken(token, DOC_ID, 'a-different-secret')).toBe(false);
  });

  it('rejects null / empty / malformed tokens', async () => {
    expect(await verifyOwnerDocPreviewToken(null, DOC_ID, SECRET)).toBe(false);
    expect(await verifyOwnerDocPreviewToken('', DOC_ID, SECRET)).toBe(false);
    expect(await verifyOwnerDocPreviewToken('only.two', DOC_ID, SECRET)).toBe(false);
    expect(await verifyOwnerDocPreviewToken('a.b.c.d', DOC_ID, SECRET)).toBe(false);
  });

  it('rejects a token signed for a share-preview prefix (no replay across token kinds)', async () => {
    // Build a token using the share-preview prefix instead of doc-preview;
    // the verifier MUST reject it even if the doc_id happens to match a
    // share slug. This guards the prefix separation.
    const expiresAt = Math.floor(Date.now() / 1000) + 600;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign(
      'HMAC',
      key,
      enc.encode(`owner-preview:${DOC_ID}:${expiresAt}`), // wrong prefix
    );
    const bytes = new Uint8Array(sig);
    let str = '';
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
    const mac = btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const crossToken = `${DOC_ID}.${expiresAt}.${mac}`;
    expect(await verifyOwnerDocPreviewToken(crossToken, DOC_ID, SECRET)).toBe(false);
  });
});
