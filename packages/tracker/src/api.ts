// Public window.HTMLRadar surface. Three methods only: ready, flush, optOut.
// Programmatic event subscription happens through the hooks config (see
// boot()), not through a separate listener API. Keeping the public surface
// this small means we can change tracker internals without breaking
// integrations.

import type { SessionInfo } from './types.js';
import type { Session } from './session.js';
import { optOut } from './identity.js';

export interface HTMLRadarApi {
  readonly version: string;
  readonly ready: Promise<SessionInfo>;
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
  ready: Promise<SessionInfo>;
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
    },
  };

  window.HTMLRadar = api;
  return api;
}
