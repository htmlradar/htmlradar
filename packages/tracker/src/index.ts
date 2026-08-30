// Boot order matters here. We:
//   1. Bail if the recipient has opted out. On proxy-served documents the
//      opt-out never reaches this check — the proxy drops the whole script
//      tag when its `hr_optout` cookie is present. This flag covers a
//      directly-embedded tracker, where localStorage works.
//   2. Resolve config. If required attrs are missing, log + exit — the host
//      shouldn't fail silently when the tracker is misconfigured.
//   3. Get an identity (fingerprint + maybe email). Email source priority:
//      proxy-injected (allow-list flow) > stored > Shadow-DOM gate prompt.
//   4. Start the session, install the global API. The Promise returned to
//      `window.HTMLRadar.ready` resolves once the first RPC succeeds, so
//      hosts can chain `await window.HTMLRadar.ready` before customizing.

import { resolveConfig } from './config.js';
import { showEmailGate } from './gate.js';
import { getFingerprint, getStoredEmail, isOptedOut, setStoredEmail } from './identity.js';
import { Session } from './session.js';
import { installGlobalApi } from './api.js';
import { createTransport, RpcError, type StartSessionResult } from './transport.js';

// Map server-side RPC error codes to recipient-friendly messages.
// These messages render inside the email gate when start_session rejects
// the entered email. Anything not matched falls through to a generic line
// so the recipient at least knows something failed.
function humanError(err: unknown): string {
  if (err instanceof RpcError) {
    switch (err.code) {
      case 'P0001':
        return 'Too many tries from this email. Wait a minute, then try again.';
      case 'P0002':
        return "This link doesn't seem to exist. Ask the sender for a fresh one.";
      case 'P0003':
        return 'The sender revoked this link. Ask them for a new one.';
      case 'P0004':
        return 'This link has expired. Ask the sender for a fresh one.';
      case 'P0006':
        return 'That email looks malformed. Check the spelling.';
      case 'P0007':
        return "Your email's domain isn't on the sender's allow list. Use the address they're expecting.";
      case 'P0008':
        return 'The document for this link was removed.';
      case 'P0023':
        return "Disposable email addresses aren't accepted here. Use your work email.";
      default:
        return "Something didn't work. Try again, or contact the sender.";
    }
  }
  return "We couldn't reach the server. Check your connection and try again.";
}

declare const __VERSION__: string;

const VERSION: string = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';

// Boot is async; we run it from the top-level of the bundle.
void boot();

async function boot(): Promise<void> {
  if (isOptedOut()) return;

  const scriptEl = document.currentScript as HTMLScriptElement | null;
  const config = resolveConfig(scriptEl);
  if (!config) {
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn(
        '[HTMLRadar] missing required config (supabaseUrl, supabaseAnonKey, shareSlug). Tracker disabled.',
      );
    }
    return;
  }

  const fingerprint = getFingerprint();
  const storedEmail = getStoredEmail();

  let email: string | null = null;
  let preStarted: StartSessionResult | undefined;

  if (config.email) {
    // Proxy already collected + validated the email (allow-list flow).
    email = config.email;
    if (email !== storedEmail) setStoredEmail(email);
  } else if (config.privacy.mode === 'email-gated' && config.gate.enabled) {
    if (storedEmail) {
      // Returning recipient — skip the gate, let Session do the start_session
      // call. Errors here fall back to the silent path (no gate to display
      // them in), which is the acceptable trade-off for the no-prompt UX.
      email = storedEmail;
    } else {
      // First-time recipient — gate stays open until start_session succeeds.
      // The attempt callback drives both validation and the real RPC, so a
      // successful submission already has a live session by the time the
      // gate closes. Session then installs the pre-started result instead
      // of calling start_session a second time.
      const transport = createTransport({
        supabaseUrl: config.supabaseUrl,
        anonKey: config.supabaseAnonKey,
      });
      email = await showEmailGate(config, async (candidate) => {
        try {
          preStarted = await transport.startSession({
            shareSlug: config.shareSlug,
            email: candidate,
            fingerprint,
            referrer: document.referrer ?? '',
            userAgent: navigator.userAgent ?? '',
            ...(config.geo ? { geo: config.geo } : {}),
          });
          return null;
        } catch (err) {
          if (config.debug) {
            // eslint-disable-next-line no-console
            console.warn('[HTMLRadar] gate attempt rejected', err);
          }
          return humanError(err);
        }
      });
      setStoredEmail(email);
    }
  }

  const session = new Session({
    config,
    email,
    fingerprint,
    ...(preStarted ? { preStarted } : {}),
  });
  // Session.start() now returns null when it bails out during the 5s
  // warm-up filter (recipient bounced before the session could be
  // created). The `ready` promise resolves either way so hosts that
  // `await window.HTMLRadar.ready` don't hang.
  const ready = session.start().catch((err) => {
    if (config.debug) {
      // eslint-disable-next-line no-console
      console.warn('[HTMLRadar] session start failed', err);
    }
    throw err;
  });

  installGlobalApi({ session, ready, version: VERSION });
}
