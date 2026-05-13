// Visitor identity: a stable opaque fingerprint per browser-profile.
// Stored in localStorage so the same person across tabs/visits is one viewer row.
// No PII, no cross-site tracking — just a random uuid scoped to our app.

const PREFIX = 'htmlradar:';
const FP_KEY = `${PREFIX}fp`;
const EMAIL_KEY = `${PREFIX}email`;
const OPT_OUT_KEY = `${PREFIX}optout`;

export function isOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

export function optOut(): void {
  try {
    localStorage.setItem(OPT_OUT_KEY, '1');
    localStorage.removeItem(FP_KEY);
    localStorage.removeItem(EMAIL_KEY);
  } catch {
    // localStorage unavailable in private mode; treat as opt-out for this session
  }
}

export function getFingerprint(): string {
  try {
    const existing = localStorage.getItem(FP_KEY);
    if (existing) return existing;
    const fresh = randomId();
    localStorage.setItem(FP_KEY, fresh);
    return fresh;
  } catch {
    return randomId();
  }
}

export function getStoredEmail(): string | null {
  try {
    return localStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

export function setStoredEmail(email: string): void {
  try {
    localStorage.setItem(EMAIL_KEY, email);
  } catch {
    // ignore
  }
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
