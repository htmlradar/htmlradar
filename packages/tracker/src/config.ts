// Two-source config:
//   1. `<script data-*>` attributes — the 90% case, lets people drop a one-liner
//      into their HTML with no inline scripting.
//   2. `window.HTMLRadarConfig` — runtime override, used by the proxy to inject
//      verified email + geo into the page, and by power users who want hooks.
// Runtime values win when both are present.
//
// We deep-merge against DEFAULTS rather than asking callers to specify every
// field. If validation fails (missing required attrs), we return null and the
// boot path bails — no half-running tracker silently consuming events.

import type { TrackerConfig } from './types.js';

// DeepPartial — `Partial<T>` only makes top-level fields optional, which
// forces test/runtime callers to supply every nested field. DeepPartial
// makes the whole tree optional, matching how host pages actually use
// `window.HTMLRadarConfig` (sparse overrides). Function-typed properties
// are passed through untouched — without this guard, hook signatures get
// recursively-partialized into `{}` which then doesn't satisfy the call.
type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

declare global {
  interface Window {
    HTMLRadarConfig?: DeepPartial<TrackerConfig> & {
      supabaseUrl?: string;
      supabaseAnonKey?: string;
      shareSlug?: string;
    };
  }
}

const DEFAULTS: Omit<TrackerConfig, 'supabaseUrl' | 'supabaseAnonKey' | 'shareSlug'> = {
  sections: {
    selector: 'h1[id], h2[id], h3[id]',
    boundaryOffsetPx: 120,
    minDwellMs: 3000,
  },
  session: {
    heartbeatMs: 15000,
    maxSessionMinutes: 120,
  },
  gate: {
    enabled: true,
    brand: { accentColor: '#1a8870', backgroundColor: '#faf7f1' },
    copy: {
      heading: 'View this document',
      subhead: 'Enter your email to continue.',
      buttonLabel: 'View document',
      placeholder: 'you@example.com',
      privacyNote: 'Your email is shared with the sender of this document.',
    },
  },
  privacy: { mode: 'email-gated' },
  hooks: {},
  debug: false,
};

export function resolveConfig(scriptEl: HTMLScriptElement | null): TrackerConfig | null {
  const fromAttrs = scriptEl ? readScriptAttrs(scriptEl) : {};
  const fromRuntime = window.HTMLRadarConfig ?? {};

  const supabaseUrl = fromRuntime.supabaseUrl ?? fromAttrs.supabaseUrl;
  const supabaseAnonKey = fromRuntime.supabaseAnonKey ?? fromAttrs.supabaseAnonKey;
  const shareSlug = fromRuntime.shareSlug ?? fromAttrs.shareSlug;

  if (!supabaseUrl || !supabaseAnonKey || !shareSlug) {
    return null;
  }

  const config: TrackerConfig = {
    supabaseUrl,
    supabaseAnonKey,
    shareSlug,
    sections: { ...DEFAULTS.sections, ...(fromRuntime.sections ?? {}) },
    session: { ...DEFAULTS.session, ...(fromRuntime.session ?? {}) },
    gate: {
      ...DEFAULTS.gate,
      ...(fromRuntime.gate ?? {}),
      brand: { ...DEFAULTS.gate.brand, ...(fromRuntime.gate?.brand ?? {}) },
      copy: { ...DEFAULTS.gate.copy, ...(fromRuntime.gate?.copy ?? {}) },
    },
    privacy: { ...DEFAULTS.privacy, ...(fromRuntime.privacy ?? {}) },
    hooks: fromRuntime.hooks ?? {},
    debug: fromRuntime.debug ?? false,
  };
  if (fromRuntime.email) config.email = fromRuntime.email;
  if (fromRuntime.geo) config.geo = fromRuntime.geo;
  return config;
}

interface ScriptAttrs {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  shareSlug?: string;
}

function readScriptAttrs(el: HTMLScriptElement): ScriptAttrs {
  const out: ScriptAttrs = {};
  if (el.dataset['supabaseUrl']) out.supabaseUrl = el.dataset['supabaseUrl'];
  if (el.dataset['supabaseAnonKey']) out.supabaseAnonKey = el.dataset['supabaseAnonKey'];
  if (el.dataset['shareSlug']) out.shareSlug = el.dataset['shareSlug'];
  return out;
}

export { DEFAULTS };
