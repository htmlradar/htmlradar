import { describe, expect, it } from 'vitest';
import {
  issueAuthCookie,
  issueEmailCookie,
  verifyAuthCookie,
  verifyEmailCookie,
} from '../src/auth.js';

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
