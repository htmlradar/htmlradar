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

describe('the shared HMAC vector', () => {
  // Fixed secret, fixed fields, fixed expected signature. The same vector is
  // asserted in packages/connector/tests/consent.test.ts against that
  // package's own sign() — if the two ever compute a different signature for
  // these inputs, one of these two tests catches it before the app and the
  // Worker do.
  const VECTOR = {
    tx: 'f'.repeat(32),
    clientId: 'https://claude.ai/.well-known/oauth-client',
    clientHost: 'claude.ai',
    scope: 'shares:read shares:write',
    exp: '1893456000',
    secret: 'connector-contract-fixture-secret',
    sig: 'O6khTth_bVYGR8vqxQ6vErAJYar-Cm1vt9DNqUNG-wc',
  };

  it('signs the consent leg the same way the connector does', async () => {
    const payload = consentPayload(VECTOR);
    expect(await hmacSign(payload, VECTOR.secret)).toBe(VECTOR.sig);
    expect(await verifyHmac(payload, VECTOR.sig, VECTOR.secret)).toBe(true);
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
