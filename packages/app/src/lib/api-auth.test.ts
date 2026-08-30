import { describe, it, expect } from 'vitest';
import {
  apiKeyPrefix,
  API_KEY_PREFIX,
  FREE_LIMIT_REACHED,
  generateApiKey,
  hashApiKey,
  mapCreateShareError,
  parseBearerKey,
  tooLarge,
  validationError,
} from './api-auth';

const VALID = `${API_KEY_PREFIX}${'a1b2c3d4'.repeat(5)}`; // 40 hex characters

describe('parsing the bearer header', () => {
  it('accepts a well-formed key', () => {
    expect(parseBearerKey(`Bearer ${VALID}`)).toBe(VALID);
  });

  it('tolerates surrounding whitespace and extra spaces after Bearer', () => {
    expect(parseBearerKey(`  Bearer   ${VALID}  `)).toBe(VALID);
  });

  it('rejects a missing or empty header', () => {
    expect(parseBearerKey(null)).toBeNull();
    expect(parseBearerKey(undefined)).toBeNull();
    expect(parseBearerKey('')).toBeNull();
  });

  it('rejects anything that is not a Bearer scheme', () => {
    expect(parseBearerKey(VALID)).toBeNull();
    expect(parseBearerKey(`Basic ${VALID}`)).toBeNull();
    expect(parseBearerKey(`bearer ${VALID}`)).toBeNull();
  });

  it('rejects keys that are the wrong shape', () => {
    expect(parseBearerKey('Bearer hr_test_' + 'a'.repeat(40))).toBeNull();
    expect(parseBearerKey(`Bearer ${API_KEY_PREFIX}${'a'.repeat(39)}`)).toBeNull();
    expect(parseBearerKey(`Bearer ${API_KEY_PREFIX}${'a'.repeat(41)}`)).toBeNull();
    // Uppercase hex is not what we issue, so it is not what we accept.
    expect(parseBearerKey(`Bearer ${API_KEY_PREFIX}${'A1B2C3D4'.repeat(5)}`)).toBeNull();
    expect(parseBearerKey(`Bearer ${API_KEY_PREFIX}${'z'.repeat(40)}`)).toBeNull();
  });

  it('rejects a key with anything appended', () => {
    expect(parseBearerKey(`Bearer ${VALID} extra`)).toBeNull();
    expect(parseBearerKey(`Bearer ${VALID}'--`)).toBeNull();
  });
});

describe('hashing', () => {
  it('is SHA-256 in lowercase hex', async () => {
    // Standard vector, so a change of algorithm cannot pass unnoticed.
    expect(await hashApiKey('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the whole key including its prefix', async () => {
    expect(await hashApiKey(VALID)).not.toBe(await hashApiKey(VALID.slice(API_KEY_PREFIX.length)));
  });

  it('is stable and 64 characters wide', async () => {
    const once = await hashApiKey(VALID);
    expect(once).toBe(await hashApiKey(VALID));
    expect(once).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('generating a key', () => {
  it('produces a key its own parser accepts', () => {
    const key = generateApiKey();
    expect(parseBearerKey(`Bearer ${key}`)).toBe(key);
  });

  it('does not repeat itself', () => {
    const keys = new Set(Array.from({ length: 200 }, generateApiKey));
    expect(keys.size).toBe(200);
  });

  it('stores only a short, non-authenticating prefix', () => {
    const key = generateApiKey();
    const prefix = apiKeyPrefix(key);
    expect(prefix).toHaveLength(14);
    expect(key.startsWith(prefix)).toBe(true);
    expect(parseBearerKey(`Bearer ${prefix}`)).toBeNull();
  });
});

describe('mapping a create_share failure to a response', () => {
  it('turns the free-tier cap into 402 with an upgrade URL', () => {
    const byName = mapCreateShareError('free_tier_share_cap_reached');
    const byHint = mapCreateShareError('Free tier is 2 tracked links, lifetime. Upgrade to Pro.');
    expect(byName).toEqual(FREE_LIMIT_REACHED);
    expect(byHint).toEqual(FREE_LIMIT_REACHED);
    expect(byName.status).toBe(402);
    expect(byName.body).toEqual({
      error: 'free_limit_reached',
      message: 'Free accounts get 2 tracked links. Upgrade at https://htmlradar.com/upgrade',
      upgrade_url: 'https://htmlradar.com/upgrade',
    });
  });

  it('turns chosen-address failures into 422 with the customer-facing copy', () => {
    expect(mapCreateShareError('slug_requires_pro').status).toBe(422);
    expect(mapCreateShareError('slug_requires_pro').body['message']).toMatch(/Pro feature/);
    expect(mapCreateShareError('slug_reserved').body['message']).toMatch(/reserved/);
    expect(mapCreateShareError('slug_invalid_format').body['message']).toMatch(/3 to 60/);
    expect(mapCreateShareError('slug_unavailable').body['message']).toMatch(/not available/);
  });

  it('explains a missing document rather than leaking the exception name', () => {
    const r = mapCreateShareError('document_not_found');
    expect(r.status).toBe(422);
    expect(r.body['message']).toBe('That document does not exist, or it is not yours.');
  });

  // The point of the fallback is that it forwards nothing. A raw Postgres
  // message carries constraint names, column names and sometimes the offending
  // value, none of which a caller can act on and all of which describe the
  // system behind the endpoint.
  it('says nothing at all about an error it does not recognise', () => {
    expect(mapCreateShareError('duplicate key value violates constraint "x_pkey"')).toEqual({
      status: 500,
      body: { error: 'internal' },
    });
    expect(JSON.stringify(mapCreateShareError('column "secret_col" does not exist'))).not.toContain(
      'secret_col',
    );
  });
});

describe('the other error responses the contract fixes', () => {
  it('413 carries the byte cap', () => {
    expect(tooLarge(31457280)).toEqual({
      status: 413,
      body: { error: 'too_large', max_bytes: 31457280 },
    });
  });

  it('422 carries a message', () => {
    expect(validationError('Provide either "html" or "url".')).toEqual({
      status: 422,
      body: { error: 'validation', message: 'Provide either "html" or "url".' },
    });
  });
});
