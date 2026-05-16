import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';

function withScript(attrs: Record<string, string>): HTMLScriptElement {
  const el = document.createElement('script');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

describe('resolveConfig', () => {
  beforeEach(() => {
    delete window.HTMLRadarConfig;
  });

  afterEach(() => {
    delete window.HTMLRadarConfig;
  });

  it('returns null when required script attrs are missing', () => {
    expect(resolveConfig(null)).toBeNull();
    expect(resolveConfig(withScript({}))).toBeNull();
    expect(resolveConfig(withScript({ 'data-supabase-url': 'x' }))).toBeNull();
  });

  it('reads supabase + slug from data attributes', () => {
    const el = withScript({
      'data-supabase-url': 'https://x.supabase.co',
      'data-supabase-anon-key': 'eyJanon',
      'data-share-slug': 'swift-falcon-a3f2',
    });
    const config = resolveConfig(el);
    expect(config?.supabaseUrl).toBe('https://x.supabase.co');
    expect(config?.supabaseAnonKey).toBe('eyJanon');
    expect(config?.shareSlug).toBe('swift-falcon-a3f2');
  });

  it('uses 3000ms minDwell default (audit F-7)', () => {
    const config = resolveConfig(
      withScript({
        'data-supabase-url': 'https://x.supabase.co',
        'data-supabase-anon-key': 'eyJanon',
        'data-share-slug': 's',
      }),
    );
    expect(config?.sections.minDwellMs).toBe(3000);
  });

  it('runtime config overrides data attrs and merges with defaults', () => {
    window.HTMLRadarConfig = {
      supabaseUrl: 'https://override.supabase.co',
      sections: { minDwellMs: 1500 },
      gate: { copy: { heading: 'Custom heading' } },
    };
    const config = resolveConfig(
      withScript({
        'data-supabase-url': 'https://from-attr.supabase.co',
        'data-supabase-anon-key': 'eyJanon',
        'data-share-slug': 's',
      }),
    );
    expect(config?.supabaseUrl).toBe('https://override.supabase.co');
    expect(config?.sections.minDwellMs).toBe(1500);
    expect(config?.sections.boundaryOffsetPx).toBe(120); // default kept
    expect(config?.gate.copy.heading).toBe('Custom heading');
    expect(config?.gate.copy.buttonLabel).toBe('Open document'); // default kept
  });

  it('propagates proxy-injected email + geo when present', () => {
    window.HTMLRadarConfig = {
      email: 'marc@example-ventures.test',
      geo: { country: 'US', city: 'NYC', deviceType: 'desktop', os: 'macOS', browser: 'Safari' },
    };
    const config = resolveConfig(
      withScript({
        'data-supabase-url': 'https://x.supabase.co',
        'data-supabase-anon-key': 'eyJanon',
        'data-share-slug': 's',
      }),
    );
    expect(config?.email).toBe('marc@example-ventures.test');
    expect(config?.geo?.country).toBe('US');
    expect(config?.geo?.browser).toBe('Safari');
  });
});
