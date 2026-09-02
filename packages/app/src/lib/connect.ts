const encoder = new TextEncoder();

export const CONNECT_CALLBACK_URL = 'https://mcp.htmlradar.com/connect/callback';
export const CONNECTOR_LABEL_PREFIX = 'Claude connector, ';
export const READ_SCOPE = 'shares:read';
export const FULL_SCOPE = 'shares:read shares:write';

export interface ConnectRequest {
  tx: string;
  clientId: string;
  clientHost: string;
  scope: string;
  exp: string;
  sig: string;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signatureBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  try {
    return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) =>
      c.charCodeAt(0),
    );
  } catch {
    return null;
  }
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i]! ^ b[i]!;
  return mismatch === 0;
}

export function randomBase64url(byteLength: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Hex(value: string): Promise<string> {
  return [...(await digest(value))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
}

export async function verifyHmac(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!secret) return false;
  const actual = signatureBytes(signature);
  if (!actual) return false;
  const expected = signatureBytes(await hmacSign(payload, secret));
  return expected !== null && equalBytes(actual, expected);
}

export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  return equalBytes(await digest(a), await digest(b));
}

export function isExpired(exp: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return !/^\d+$/.test(exp) || !Number.isSafeInteger(Number(exp)) || Number(exp) <= nowSeconds;
}

export function consentPayload(request: ConnectRequest): string {
  return `${request.tx}\n${request.clientId}\n${request.clientHost}\n${request.scope}\n${request.exp}`;
}

export async function validConnectRequest(
  request: ConnectRequest,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!/^[0-9a-f]{32}$/.test(request.tx)) return false;
  if (!request.clientId || !request.clientHost) return false;
  try {
    if (new URL(request.clientId).host !== request.clientHost) return false;
  } catch {
    return false;
  }
  const scopes = request.scope.split(' ');
  if (
    scopes.some((scope) => scope !== READ_SCOPE && scope !== 'shares:write') ||
    new Set(scopes).size !== scopes.length
  ) {
    return false;
  }
  if (isExpired(request.exp, nowSeconds)) return false;
  return verifyHmac(consentPayload(request), request.sig, secret);
}

export async function createConsentNonce(
  tx: string,
  userId: string,
  exp: string,
  secret: string,
): Promise<string> {
  const value = randomBase64url(16);
  return `${value}.${await hmacSign(`${value}\n${tx}\n${userId}\n${exp}`, secret)}`;
}

export async function verifyConsentNonce(
  token: string,
  tx: string,
  userId: string,
  exp: string,
  secret: string,
): Promise<boolean> {
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const value = token.slice(0, dot);
  return verifyHmac(`${value}\n${tx}\n${userId}\n${exp}`, token.slice(dot + 1), secret);
}
