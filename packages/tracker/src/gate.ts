import type { TrackerConfig } from './types.js';
import { EMAIL_REGEX } from './identity.js';

// Email gate rendered in a Shadow DOM so host-page CSS can't bleed into us
// and our styles can't break the host. Brand overrides via constructor opts.
//
// Returns a promise that resolves with the entered email, or rejects if the
// host removes the element. Callers handle storage + transport.
export function showEmailGate(config: TrackerConfig): Promise<string> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.id = 'htmlradar-gate';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = template(config);

    const form = shadow.querySelector<HTMLFormElement>('form')!;
    const input = shadow.querySelector<HTMLInputElement>('input[type=email]')!;
    const error = shadow.querySelector<HTMLElement>('.error')!;
    const button = shadow.querySelector<HTMLButtonElement>('button')!;

    requestAnimationFrame(() => input.focus());

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = input.value.trim().toLowerCase();
      if (!EMAIL_REGEX.test(value)) {
        error.textContent = 'Please enter a valid email address.';
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      button.disabled = true;
      host.remove();
      resolve(value);
    });
  });
}

function template(config: TrackerConfig): string {
  const c = config.gate.copy;
  const accent = safeCssColor(config.gate.brand.accentColor, '#1a8870');
  const bg = safeCssColor(config.gate.brand.backgroundColor, '#faf7f1');
  const b = { accentColor: accent, backgroundColor: bg };
  // No <style> tag from host CSS reaches inside the shadow root.
  return `
<style>
  :host { all: initial; }
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(28, 24, 20, 0.55);
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif;
    color: #1c1814;
  }
  .card {
    background: ${b.backgroundColor};
    border-radius: 12px;
    box-shadow: 0 24px 64px -16px rgba(0,0,0,0.25), 0 4px 12px rgba(0,0,0,0.08);
    padding: 32px;
    width: 100%;
    max-width: 420px;
  }
  h2 { margin: 0 0 8px; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
  p.subhead { margin: 0 0 20px; color: #6b6258; font-size: 15px; line-height: 1.5; }
  label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; }
  input[type=email] {
    width: 100%; box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid #ddd4c2; border-radius: 6px;
    font-size: 15px; line-height: 1.4;
    background: #fff; color: #1c1814;
    outline: none;
    transition: border-color 120ms;
  }
  input[type=email]:focus { border-color: ${b.accentColor}; }
  input[aria-invalid="true"] { border-color: #b35314; }
  .error { color: #b35314; font-size: 13px; min-height: 18px; margin-top: 6px; }
  button {
    margin-top: 16px;
    width: 100%;
    padding: 11px 16px;
    background: ${b.accentColor};
    color: #fff;
    border: none; border-radius: 6px;
    font-size: 15px; font-weight: 500;
    cursor: pointer;
    transition: opacity 120ms;
  }
  button:hover { opacity: 0.92; }
  button:disabled { opacity: 0.5; cursor: default; }
  .privacy { margin-top: 14px; font-size: 12px; color: #6b6258; line-height: 1.5; }
  .footer {
    margin-top: 20px; padding-top: 16px;
    border-top: 1px solid #e8e1d2;
    font-size: 11px; color: #9b9285;
    text-align: right;
    font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  }
  .footer a { color: inherit; text-decoration: none; border-bottom: 1px dotted currentColor; }
</style>
<div class="backdrop">
  <form class="card" novalidate>
    <h2>${escapeHtml(c.heading)}</h2>
    <p class="subhead">${escapeHtml(c.subhead)}</p>
    <label for="hr-email">Email</label>
    <input id="hr-email" type="email" placeholder="${escapeHtml(c.placeholder)}" required autocomplete="email" />
    <div class="error" role="alert"></div>
    <button type="submit">${escapeHtml(c.buttonLabel)}</button>
    <p class="privacy">${escapeHtml(c.privacyNote)}</p>
    <div class="footer">Shared with <a href="https://htmlradar.com" target="_blank" rel="noopener">HTMLRadar</a></div>
  </form>
</div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Brand colors are interpolated raw into `<style>`, so safeCssColor is the
// single trust boundary: anything that doesn't match a recognised CSS color
// form falls back to the default. The HTML body context (placeholder,
// heading, etc.) goes through escapeHtml.
function safeCssColor(s: string, fallback: string): string {
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
  if (/^rgba?\(\s*\d+(?:\s*,\s*\d+){2}(?:\s*,\s*[\d.]+)?\s*\)$/.test(s)) return s;
  if (/^hsla?\(\s*\d+(?:\s*,\s*[\d.]+%?){2}(?:\s*,\s*[\d.]+)?\s*\)$/.test(s)) return s;
  return fallback;
}
