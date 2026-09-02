import { describe, expect, it } from 'vitest';
import {
  consentPayload,
  hmacSign,
  isExpired,
  validConnectRequest,
  verifyHmac,
  type ConnectRequest,
} from './connect';

const SECRET = 'test-signing-secret';
const REQUEST: ConnectRequest = {
  tx: 'a'.repeat(32),
  clientId: 'https://claude.ai/.well-known/oauth-client',
  clientHost: 'claude.ai',
  scope: 'shares:read shares:write',
  exp: '2000000000',
  sig: '',
};

describe('connector signatures', () => {
  it('accepts the valid signature and rejects tampering or the wrong key', async () => {
    const payload = consentPayload(REQUEST);
    const sig = await hmacSign(payload, SECRET);
    const tamperedSig = `${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`;

    expect(await verifyHmac(payload, sig, SECRET)).toBe(true);
    expect(await verifyHmac(payload, tamperedSig, SECRET)).toBe(false);
    expect(await verifyHmac(`${payload}x`, sig, SECRET)).toBe(false);
    expect(await verifyHmac(payload, sig, 'wrong-secret')).toBe(false);
    expect(await validConnectRequest({ ...REQUEST, sig }, SECRET, 1_900_000_000)).toBe(true);
  });
});

describe('connector expiry', () => {
  it('refuses an expiry at or before the current second', () => {
    expect(isExpired('101', 100)).toBe(false);
    expect(isExpired('100', 100)).toBe(true);
    expect(isExpired('99', 100)).toBe(true);
    expect(isExpired('not-a-time', 100)).toBe(true);
  });
});
