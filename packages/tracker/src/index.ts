// Boot order matters here. We:
//   1. Bail if the recipient has opted out (localStorage flag).
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
  if (config.email) {
    // Proxy already collected + validated the email (allow-list flow).
    email = config.email;
    if (email !== storedEmail) setStoredEmail(email);
  } else if (config.privacy.mode === 'email-gated' && config.gate.enabled) {
    email = storedEmail ?? (await showEmailGate(config));
    if (email !== storedEmail) setStoredEmail(email);
  }

  const session = new Session({ config, email, fingerprint });
  const ready = session.start().catch((err) => {
    if (config.debug) {
      // eslint-disable-next-line no-console
      console.warn('[HTMLRadar] session start failed', err);
    }
    throw err;
  });

  installGlobalApi({ session, ready, version: VERSION });
}
