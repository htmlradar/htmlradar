// Public window.HTMLRadar surface. Three methods only: ready, flush, optOut.
// optOut() stops the live session and then navigates to ?optout=1, where the
// proxy asks the recipient to confirm — see the note on the method.
// Programmatic event subscription happens through the hooks config (see
// boot()), not through a separate listener API. Keeping the public surface
// this small means we can change tracker internals without breaking
// integrations.

import type { SessionInfo } from './types.js';
import type { Session } from './session.js';
import { optOut } from './identity.js';

export interface HTMLRadarApi {
  readonly version: string;
  // `ready` resolves with the session info when the tracker starts a
  // session, OR with `null` when the 5s warm-up filter bailed (the
  // recipient bounced before the session row was created). Host pages
  // should null-check.
  readonly ready: Promise<SessionInfo | null>;
  flush(): Promise<void>;
  optOut(): void;
}

declare global {
  interface Window {
    HTMLRadar?: HTMLRadarApi;
  }
}

interface InstallOptions {
  session: Session;
  ready: Promise<SessionInfo | null>;
  version: string;
}

export function installGlobalApi(opts: InstallOptions): HTMLRadarApi {
  const api: HTMLRadarApi = {
    version: opts.version,
    ready: opts.ready,
    flush: () => opts.session.flush(),
    optOut: () => {
      optOut();
      opts.session.stop();
      // Stopping the session only covers this page view. Persisting the
      // choice has to happen server-side: documents served through the
      // HTMLRadar proxy run under a `sandbox` CSP with no allow-same-origin,
      // so they sit in an opaque origin where localStorage and
      // document.cookie throw and the local flag above cannot survive a
      // reload. Navigating with `optout=1` reaches the proxy's confirmation
      // page; the button there is what records the cookie, because a page a
      // document can navigate to must not change the setting on its own.
      const url = new URL(window.location.href);
      url.searchParams.set('optout', '1');
      window.location.replace(url.href);
    },
  };

  window.HTMLRadar = api;
  return api;
}
