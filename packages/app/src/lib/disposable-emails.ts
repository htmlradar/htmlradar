// List of disposable-email providers. The same set the start_session RPC
// rejects at the recipient gate (schema/005_security_followup.sql) — kept
// in sync by hand. Used at signup time so users can't trivially mint
// new accounts from 10minutemail / mailinator / etc. to skirt the
// 10-document lifetime cap.
//
// Why a TS const instead of an RPC: signup is the wrong place for an
// extra database round-trip on every submission, and the check needs to
// fire client-side anyway so the user sees the error before the magic
// link or OAuth flow starts.
//
// If this list ever grows past ~100 entries, switch to a maintained
// source (e.g. ivolo/disposable-email-domains) at build time.

const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  '10minutemail.com',
  '20minutemail.com',
  'discardmail.com',
  'dispostable.com',
  'emailondeck.com',
  'fakeinbox.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.biz',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.info',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'mail-temporaire.fr',
  'maildrop.cc',
  'mailcatch.com',
  'mailinator.com',
  'mailnesia.com',
  'mailtemp.info',
  'mintemail.com',
  'mohmal.com',
  'sharklasers.com',
  'spam4.me',
  'tempinbox.com',
  'tempmail.io',
  'temp-mail.org',
  'temp-mail.us',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.net',
  'trbvm.com',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
]);

export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}
