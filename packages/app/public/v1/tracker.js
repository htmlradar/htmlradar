var z = Object.defineProperty;
var j = (n, e, t) =>
  e in n ? z(n, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : (n[e] = t);
var l = (n, e, t) => (j(n, typeof e != 'symbol' ? e + '' : e, t), t);
var m = {
  sections: { selector: 'h1, h2, h3', boundaryOffsetPx: 120, minDwellMs: 3e3 },
  session: { heartbeatMs: 15e3, maxSessionMinutes: 120 },
  gate: {
    enabled: !0,
    brand: { accentColor: '#7A1F2E', backgroundColor: '#FAF5EE' },
    copy: {
      heading: 'Confirm your email to open.',
      subhead: 'The sender wants to know when this document gets read.',
      buttonLabel: 'Open document',
      placeholder: 'you@company.com',
      privacyNote: 'Your email goes to the sender only. Not used for marketing.',
    },
  },
  privacy: { mode: 'email-gated' },
  hooks: {},
  debug: !1,
};
function L(n) {
  let e = n ? V(n) : {},
    t = window.HTMLRadarConfig ?? {},
    r = t.supabaseUrl ?? e.supabaseUrl,
    i = t.supabaseAnonKey ?? e.supabaseAnonKey,
    o = t.shareSlug ?? e.shareSlug;
  if (!r || !i || !o) return null;
  let s = {
    supabaseUrl: r,
    supabaseAnonKey: i,
    shareSlug: o,
    sections: { ...m.sections, ...(t.sections ?? {}) },
    session: { ...m.session, ...(t.session ?? {}) },
    gate: {
      ...m.gate,
      ...(t.gate ?? {}),
      brand: { ...m.gate.brand, ...(t.gate?.brand ?? {}) },
      copy: { ...m.gate.copy, ...(t.gate?.copy ?? {}) },
    },
    privacy: { ...m.privacy, ...(t.privacy ?? {}) },
    hooks: t.hooks ?? {},
    debug: t.debug ?? !1,
  };
  return (t.email && (s.email = t.email), t.geo && (s.geo = t.geo), s);
}
function V(n) {
  let e = {};
  return (
    n.dataset.supabaseUrl && (e.supabaseUrl = n.dataset.supabaseUrl),
    n.dataset.supabaseAnonKey && (e.supabaseAnonKey = n.dataset.supabaseAnonKey),
    n.dataset.shareSlug && (e.shareSlug = n.dataset.shareSlug),
    e
  );
}
var M = 'htmlradar:',
  w = `${M}fp`,
  k = `${M}email`,
  A = `${M}optout`;
function _() {
  try {
    return localStorage.getItem(A) === '1';
  } catch {
    return !1;
  }
}
function R() {
  try {
    (localStorage.setItem(A, '1'), localStorage.removeItem(w), localStorage.removeItem(k));
  } catch {}
}
function H() {
  try {
    let n = localStorage.getItem(w);
    if (n) return n;
    let e = C();
    return (localStorage.setItem(w, e), e);
  } catch {
    return C();
  }
}
function O() {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function I(n) {
  try {
    localStorage.setItem(k, n);
  } catch {}
}
function C() {
  return typeof crypto < 'u' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (n) => {
        let e = (Math.random() * 16) | 0;
        return (n === 'x' ? e : (e & 3) | 8).toString(16);
      });
}
var P = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function F(n, e) {
  return new Promise((t) => {
    let r = document.createElement('div');
    ((r.id = 'htmlradar-gate'),
      (r.style.cssText = 'position:fixed;inset:0;z-index:2147483647;'),
      document.body.appendChild(r));
    let i = r.attachShadow({ mode: 'closed' });
    i.innerHTML = B(n);
    let o = i.querySelector('form'),
      s = i.querySelector('input[type=email]'),
      a = i.querySelector('.error'),
      c = i.querySelector('button'),
      d = c.textContent ?? 'Continue';
    requestAnimationFrame(() => s.focus());
    let u = (T) => {
        ((a.textContent = T), s.setAttribute('aria-invalid', 'true'));
      },
      S = () => {
        ((a.textContent = ''), s.removeAttribute('aria-invalid'));
      };
    (s.addEventListener('input', S),
      o.addEventListener('submit', async (T) => {
        T.preventDefault();
        let E = s.value.trim().toLowerCase();
        if (!P.test(E)) {
          u('Please enter a valid email address.');
          return;
        }
        ((c.disabled = !0), (c.textContent = 'Loading\u2026'), S());
        let b;
        try {
          b = await e(E);
        } catch {
          b = "We couldn't reach the server. Check your connection and try again.";
        }
        if (b) {
          ((c.disabled = !1), (c.textContent = d), u(b));
          return;
        }
        (r.remove(), t(E));
      }));
  });
}
function B(n) {
  let e = n.gate.copy,
    t = $(n.gate.brand.accentColor, '#1a8870'),
    r = $(n.gate.brand.backgroundColor, '#faf7f1'),
    i = { accentColor: t, backgroundColor: r };
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
    background: ${i.backgroundColor};
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
  input[type=email]:focus { border-color: ${i.accentColor}; }
  input[aria-invalid="true"] { border-color: #b35314; }
  .error { color: #b35314; font-size: 13px; min-height: 18px; margin-top: 6px; }
  button {
    margin-top: 16px;
    width: 100%;
    padding: 11px 16px;
    background: ${i.accentColor};
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
    <h2>${g(e.heading)}</h2>
    <p class="subhead">${g(e.subhead)}</p>
    <label for="hr-email">Email</label>
    <input id="hr-email" type="email" placeholder="${g(e.placeholder)}" required autocomplete="email" />
    <div class="error" role="alert"></div>
    <button type="submit">${g(e.buttonLabel)}</button>
    <p class="privacy">${g(e.privacyNote)}</p>
    <div class="footer">Shared with <a href="https://htmlradar.com" target="_blank" rel="noopener">HTMLRadar</a></div>
  </form>
</div>`;
}
function g(n) {
  return n
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function $(n, e) {
  return /^#[0-9a-fA-F]{3,8}$/.test(n) ||
    /^rgba?\(\s*\d+(?:\s*,\s*\d+){2}(?:\s*,\s*[\d.]+)?\s*\)$/.test(n) ||
    /^hsla?\(\s*\d+(?:\s*,\s*[\d.]+%?){2}(?:\s*,\s*[\d.]+)?\s*\)$/.test(n)
    ? n
    : e;
}
var y = class {
  constructor(e) {
    l(this, 'opts');
    l(this, 'sections', []);
    l(this, 'currentId', null);
    l(this, 'currentStartMs', null);
    l(this, 'rafScheduled', !1);
    l(this, 'active', !1);
    l(this, 'intersectionByElement', new WeakMap());
    l(this, 'intersectionObserver', null);
    l(this, 'onScroll', () => {
      this.rafScheduled ||
        ((this.rafScheduled = !0),
        requestAnimationFrame(() => {
          ((this.rafScheduled = !1), this.update(performance.now()));
        }));
    });
    this.opts = e;
  }
  start() {
    this.active ||
      ((this.active = !0),
      this.discoverSections(),
      this.installObserver(),
      window.addEventListener('scroll', this.onScroll, { passive: !0 }),
      this.update(performance.now()));
  }
  stop() {
    this.active &&
      ((this.active = !1),
      this.creditCurrent(performance.now()),
      window.removeEventListener('scroll', this.onScroll),
      this.intersectionObserver?.disconnect(),
      (this.intersectionObserver = null));
  }
  pause() {
    (this.creditCurrent(performance.now()), (this.currentStartMs = null));
  }
  resume() {
    this.currentId !== null && (this.currentStartMs = performance.now());
  }
  snapshot() {
    return (
      this.creditCurrent(performance.now()),
      this.currentId !== null && (this.currentStartMs = performance.now()),
      this.sections
        .filter((e) => e.accumulatedMs >= this.opts.minDwellMs)
        .map((e) => ({
          id: e.id,
          title: e.title,
          depth: e.depth,
          ordinal: e.ordinal,
          timeSeconds: e.accumulatedMs / 1e3,
        }))
    );
  }
  discoverSections() {
    let e = W(this.opts.selector),
      t = new Map();
    e.elements.forEach((r, i) => {
      let o = r.id;
      if (!o)
        if (e.strategy === 'slides') o = `slide-${i + 1}`;
        else if (e.strategy === 'prose') {
          let c = U((r.textContent ?? '').trim());
          o = K(c) || `part-${i + 1}`;
        } else o = K((r.textContent ?? '').trim()) || `section-${i + 1}`;
      let s = (t.get(o) ?? 0) + 1;
      (t.set(o, s), s > 1 && (o = `${o}-${s}`));
      let a;
      (e.strategy === 'slides'
        ? (a = Q(r, i + 1))
        : e.strategy === 'prose'
          ? (a = U((r.textContent ?? '').trim()) || `Part ${i + 1}`)
          : (a = f(r.textContent ?? '').slice(0, 200) || `Section ${i + 1}`),
        this.sections.push({
          id: o,
          title: a,
          depth: e.strategy === 'slides' || e.strategy === 'prose' ? 1 : G(r.tagName),
          ordinal: i,
          element: r,
          accumulatedMs: 0,
          hasReadFired: !1,
        }));
    });
  }
  update(e) {
    let t = this.computeCurrent();
    if (
      t !== this.currentId &&
      (this.creditCurrent(e),
      (this.currentId = t),
      (this.currentStartMs = t === null ? null : e),
      t !== null)
    ) {
      let r = this.sections.find((i) => i.id === t);
      r && this.opts.onSectionEnter && this.opts.onSectionEnter(D(r));
    }
  }
  creditCurrent(e) {
    if (this.currentId === null || this.currentStartMs === null) return;
    let t = e - this.currentStartMs;
    if (t <= 0) return;
    let r = this.sections.find((i) => i.id === this.currentId);
    r &&
      ((r.accumulatedMs += t),
      !r.hasReadFired &&
        r.accumulatedMs >= this.opts.minDwellMs &&
        ((r.hasReadFired = !0), this.opts.onSectionRead && this.opts.onSectionRead(D(r))));
  }
  installObserver() {
    if (!(typeof IntersectionObserver > 'u')) {
      this.intersectionObserver = new IntersectionObserver(
        (e) => {
          for (let t of e) this.intersectionByElement.set(t.target, t.intersectionRatio);
          this.update(performance.now());
        },
        { threshold: [0, 0.1, 0.25, 0.5, 0.75, 0.95, 1] },
      );
      for (let e of this.sections) this.intersectionObserver.observe(e.element);
    }
  }
  computeCurrent() {
    let e = null,
      t = 0,
      r = !1;
    for (let s of this.sections) {
      let a = this.intersectionByElement.get(s.element);
      a !== void 0 && ((r = !0), a > t && ((t = a), (e = s.id)));
    }
    if (r) return t > 0 ? e : null;
    let i = this.opts.boundaryOffsetPx,
      o = null;
    for (let s of this.sections)
      if (s.element.getBoundingClientRect().top - i <= 0) o = s.id;
      else break;
    return o;
  }
};
function G(n) {
  switch (n) {
    case 'H1':
      return 1;
    case 'H2':
      return 2;
    case 'H3':
      return 3;
    default:
      return 4;
  }
}
function W(n) {
  let e = (i) => {
      try {
        let o = getComputedStyle(i).position;
        return o === 'fixed' || o === 'sticky';
      } catch {
        return !1;
      }
    },
    t = Array.from(document.querySelectorAll(n)).filter((i) => !e(i) && !p(f(i.textContent ?? '')));
  if (t.length >= 2) return { elements: t, strategy: 'configured' };
  if (
    ((t = Array.from(document.querySelectorAll('h1, h2, h3')).filter(
      (i) => !e(i) && !p(f(i.textContent ?? '')),
    )),
    t.length >= 2)
  )
    return { elements: t, strategy: 'headings' };
  if (
    ((t = Y(
      Array.from(
        document.querySelectorAll(
          'section, article, [class*="slide"], [class*="page"], [data-slide], [data-page], [data-page-no], [data-page-number]',
        ),
      ).filter((i) => !e(i)),
    )),
    t.length >= 2)
  )
    return { elements: t, strategy: 'slides' };
  let r = J(e);
  return r.length >= 2
    ? { elements: r, strategy: 'prose' }
    : { elements: [], strategy: 'configured' };
}
function Y(n) {
  if (n.length < 2) return n;
  let e = [...n].sort((r, i) => {
      if (r === i) return 0;
      let o = r.compareDocumentPosition(i);
      return o & Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : o & Node.DOCUMENT_POSITION_PRECEDING
          ? 1
          : 0;
    }),
    t = [];
  for (let r of e) t.some((o) => o !== r && o.contains(r)) || t.push(r);
  return t;
}
var N = 8,
  X = 40;
function J(n) {
  let e = Array.from(document.querySelectorAll('p, li, blockquote')).filter(
    (i) =>
      !(
        (i.textContent ?? '').trim().length < X ||
        n(i) ||
        i.closest(
          'nav, footer, aside, header, [role="banner"], [role="navigation"], [role="contentinfo"], [aria-hidden="true"]',
        )
      ),
  );
  if (e.length === 0) return [];
  if (e.length <= N) return e;
  let t = Math.ceil(e.length / N),
    r = [];
  for (let i = 0; i < e.length; i += t) {
    let o = e[i];
    o && r.push(o);
  }
  return r;
}
function U(n) {
  let e = n.replace(/\s+/g, ' ').trim();
  if (!e) return '';
  let t = e.slice(0, 200).match(/^[\s\S]{1,120}?[.!?](?=\s|$)/);
  return t ? t[0].trim() : e.length > 80 ? `${e.slice(0, 80)}\u2026` : e;
}
function K(n) {
  return n
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
function Q(n, e) {
  let t = n.matches('[data-section-title], [data-slide-title]')
    ? n
    : n.querySelector('[data-section-title], [data-slide-title]');
  if (t) {
    let d = t.getAttribute('data-section-title') ?? t.getAttribute('data-slide-title') ?? '',
      u = f(d);
    if (u && u.length >= 3 && !p(u)) return u.slice(0, 200);
  }
  let r = [
      '[class~="slide-label"]',
      '[class~="slide-title"]',
      '[class~="section-label"]',
      '[class~="section-title"]',
      '[class~="page-title"]',
      '[class~="day-title"]',
      '[class~="hero-title"]',
      '[class~="card-title"]',
    ].join(', '),
    i = n.querySelectorAll(r);
  for (let d of i) {
    let u = f(d.textContent ?? '');
    if (u && u.length >= 3 && !p(u)) return u.slice(0, 200);
  }
  let o = n.querySelector('h1, h2, h3, h4, [role="heading"]'),
    s = f(o?.textContent ?? '');
  if (s && !p(s) && s.length >= 3) return s.slice(0, 200);
  let a = Z(n);
  if (a) return a.slice(0, 200);
  let c = ee(n);
  return c ? c.slice(0, 200) : `Slide ${e}`;
}
function p(n) {
  let e = n.trim();
  return !!(
    !e ||
    /^\d{1,3}\s*[/—-]\s*\d{1,3}$/.test(e) ||
    /^page\s+\d{1,3}(\s*(of|\/|—|-)\s*\d{1,3})?$/i.test(e) ||
    /^slide\s+\d{1,3}(\s*(of|\/|—|-)\s*\d{1,3})?$/i.test(e) ||
    /^\d{1,3}\s+of\s+\d{1,3}$/i.test(e) ||
    /^\d{1,3}$/.test(e) ||
    /^[•·▶▸→⟶←⟵·.\-—]+$/.test(e) ||
    e.length <= 2
  );
}
function f(n) {
  return n.replace(/\s+/g, ' ').trim();
}
function Z(n) {
  let e = 0,
    t = null,
    r = document.createTreeWalker(n, NodeFilter.SHOW_ELEMENT, null),
    i = r.currentNode;
  for (; i; ) {
    let o = i;
    if (o.getAttribute('aria-hidden') === 'true') {
      i = r.nextSibling();
      continue;
    }
    let s = '';
    for (let c of o.childNodes) c.nodeType === 3 && (s += c.textContent ?? '');
    let a = f(s);
    if (a && a.length >= 3 && !p(a)) {
      let c = 0;
      try {
        c = parseFloat(getComputedStyle(o).fontSize || '0');
      } catch {
        c = 0;
      }
      (Number.isFinite(c) || (c = 0), c > e && ((e = c), (t = a)));
    }
    i = r.nextNode();
  }
  return t;
}
function ee(n) {
  let e = n.querySelectorAll('p, span, div, li');
  for (let t of e) {
    if (t.getAttribute('aria-hidden') === 'true') continue;
    let r = f(t.textContent ?? '');
    if (r && r.length >= 4 && !p(r)) return r;
  }
  return null;
}
function D(n) {
  return {
    id: n.id,
    title: n.title,
    depth: n.depth,
    ordinal: n.ordinal,
    timeSeconds: n.accumulatedMs / 1e3,
  };
}
var h = class extends Error {
  constructor(t, r, i) {
    super(r);
    this.code = t;
    this.httpStatus = i;
    this.name = 'RpcError';
  }
};
function v(n) {
  let e = (s) => `${n.supabaseUrl}/rest/v1/rpc/${s}`,
    t = (s = {}) => ({
      apikey: n.anonKey,
      Authorization: `Bearer ${n.anonKey}`,
      'Content-Type': 'application/json',
      ...s,
    });
  async function r(s, a, c = !1) {
    let d = await fetch(e(s), {
      method: 'POST',
      headers: t(),
      body: JSON.stringify(a),
      keepalive: c,
    });
    if (!d.ok) {
      let u = await d.text().catch(() => ''),
        S = te(u) ?? `http_${d.status}`;
      throw new h(S, u || d.statusText, d.status);
    }
    return d.status === 204 ? null : await d.json();
  }
  async function i(s) {
    let a = await r('start_session', {
      p_share_slug: s.shareSlug,
      p_email: s.email,
      p_fingerprint: s.fingerprint,
      p_referrer: s.referrer,
      p_user_agent: s.userAgent,
      p_country_code: s.geo?.country ?? null,
      p_city: s.geo?.city ?? null,
      p_device_type: s.geo?.deviceType ?? null,
      p_os: s.geo?.os ?? null,
      p_browser: s.geo?.browser ?? null,
    });
    return {
      sessionId: a.session_id,
      token: a.token,
      documentId: a.document_id,
      documentVersion: a.document_version,
    };
  }
  async function o(s, a = !1) {
    await r(
      'update_session',
      {
        p_session_id: s.sessionId,
        p_token: s.token,
        p_active_seconds: s.activeSeconds,
        p_max_scroll: s.maxScrollDepth,
        p_sections: s.sections,
      },
      a,
    );
  }
  return { startSession: i, updateSession: o };
}
function te(n) {
  try {
    let e = JSON.parse(n);
    if (e.code) return e.code;
    if (e.message) {
      let t = /P\d{4}/.exec(e.message);
      if (t) return t[0];
    }
  } catch {}
  return null;
}
var x = class {
  constructor(e) {
    l(this, 'opts');
    l(this, 'transport');
    l(this, 'sections');
    l(this, 'info', null);
    l(this, 'token', null);
    l(this, 'activeMs', 0);
    l(this, 'activeRunningSince', null);
    l(this, 'maxScroll', 0);
    l(this, 'heartbeatTimer', null);
    l(this, 'maxSessionTimer', null);
    l(this, 'flushing', !1);
    l(this, 'dirty', !1);
    l(this, 'rafScrollScheduled', !1);
    l(this, 'boundCount', 0);
    l(this, 'onVisibility', () => {
      document.hidden
        ? (this.tickActive(performance.now()),
          (this.activeRunningSince = null),
          this.sections.pause(),
          this.flush())
        : ((this.activeRunningSince = performance.now()), this.sections.resume());
    });
    l(this, 'onPageHide', () => {
      (this.tickActive(performance.now()),
        (this.activeRunningSince = null),
        this.sections.pause(),
        this.flush(!0));
    });
    l(this, 'onScroll', () => {
      this.rafScrollScheduled ||
        ((this.rafScrollScheduled = !0),
        requestAnimationFrame(() => {
          ((this.rafScrollScheduled = !1), this.updateMaxScroll());
        }));
    });
    ((this.opts = e),
      (this.transport = v({
        supabaseUrl: e.config.supabaseUrl,
        anonKey: e.config.supabaseAnonKey,
      })),
      (this.sections = new y({
        selector: e.config.sections.selector,
        boundaryOffsetPx: e.config.sections.boundaryOffsetPx,
        minDwellMs: e.config.sections.minDwellMs,
        ...(e.config.hooks.onSectionEnter ? { onSectionEnter: e.config.hooks.onSectionEnter } : {}),
        ...(e.config.hooks.onSectionRead ? { onSectionRead: e.config.hooks.onSectionRead } : {}),
      })));
  }
  async start() {
    if (!this.opts.preStarted) {
      if (document.hidden) return null;
      let t = 5e3;
      if ((await new Promise((r) => setTimeout(r, t)), document.hidden)) return null;
    }
    (document.hidden || (this.activeRunningSince = performance.now()),
      this.bindListeners(),
      this.sections.start(),
      this.updateMaxScroll());
    let e =
      this.opts.preStarted ??
      (await this.transport.startSession({
        shareSlug: this.opts.config.shareSlug,
        email: this.opts.email,
        fingerprint: this.opts.fingerprint,
        referrer: document.referrer ?? '',
        userAgent: navigator.userAgent ?? '',
        ...(this.opts.config.geo ? { geo: this.opts.config.geo } : {}),
      }));
    return (
      (this.info = {
        sessionId: e.sessionId,
        documentId: e.documentId,
        documentVersion: e.documentVersion,
      }),
      (this.token = e.token),
      this.startTimers(),
      this.opts.config.hooks.onSessionStart && this.opts.config.hooks.onSessionStart(this.info),
      this.info
    );
  }
  async flush(e = !1) {
    if (!(this.flushing || !this.info || !this.token)) {
      this.flushing = !0;
      try {
        (this.tickActive(performance.now()), this.updateMaxScroll());
        let t = this.sections.snapshot();
        if (t.length === 0 && !this.dirty) return;
        let r = {
            sessionId: this.info.sessionId,
            token: this.token,
            activeSeconds: Math.round(this.activeMs / 1e3),
            maxScrollDepth: this.maxScroll,
            sections: t.map((o) => ({
              section_id: o.id,
              section_title: o.title,
              depth: o.depth,
              ordinal: o.ordinal,
              time_seconds: o.timeSeconds,
            })),
          },
          i = this.opts.config.hooks.beforeFlush?.(r) ?? r;
        if (i === !1) return;
        (await this.transport.updateSession(i, e), (this.dirty = !1));
      } catch (t) {
        let r = t instanceof Error ? t : new Error(String(t));
        (this.opts.config.debug && console.warn('[HTMLRadar] flush failed', r),
          this.opts.config.hooks.onFlushError?.(r),
          t instanceof h && t.code === 'P0010' && this.stop());
      } finally {
        this.flushing = !1;
      }
    }
  }
  stop() {
    (this.heartbeatTimer !== null &&
      (clearInterval(this.heartbeatTimer), (this.heartbeatTimer = null)),
      this.maxSessionTimer !== null &&
        (clearTimeout(this.maxSessionTimer), (this.maxSessionTimer = null)),
      this.sections.stop(),
      this.unbindListeners());
  }
  startTimers() {
    ((this.heartbeatTimer = window.setInterval(
      () => void this.flush(),
      this.opts.config.session.heartbeatMs,
    )),
      (this.maxSessionTimer = window.setTimeout(
        () => this.stop(),
        this.opts.config.session.maxSessionMinutes * 6e4,
      )));
  }
  bindListeners() {
    this.boundCount > 0 ||
      ((this.boundCount = 1),
      document.addEventListener('visibilitychange', this.onVisibility),
      window.addEventListener('pagehide', this.onPageHide),
      window.addEventListener('scroll', this.onScroll, { passive: !0 }));
  }
  unbindListeners() {
    this.boundCount !== 0 &&
      ((this.boundCount = 0),
      document.removeEventListener('visibilitychange', this.onVisibility),
      window.removeEventListener('pagehide', this.onPageHide),
      window.removeEventListener('scroll', this.onScroll));
  }
  updateMaxScroll() {
    let e = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    if (e <= 0) {
      this.maxScroll < 1 && ((this.maxScroll = 1), (this.dirty = !0));
      return;
    }
    let t = Math.max(
        window.scrollY || 0,
        document.documentElement.scrollTop || 0,
        document.body.scrollTop || 0,
      ),
      r = Math.max(0, Math.min(1, t / e));
    r > this.maxScroll && ((this.maxScroll = r), (this.dirty = !0));
  }
  tickActive(e) {
    if (this.activeRunningSince === null) return;
    let t = e - this.activeRunningSince;
    (t > 0 && ((this.activeMs += t), (this.dirty = !0)), (this.activeRunningSince = e));
  }
};
function q(n) {
  let e = {
    version: n.version,
    ready: n.ready,
    flush: () => n.session.flush(),
    optOut: () => {
      (R(), n.session.stop());
    },
  };
  return ((window.HTMLRadar = e), e);
}
function ne(n) {
  if (n instanceof h)
    switch (n.code) {
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
  return "We couldn't reach the server. Check your connection and try again.";
}
var re = '0.1.0';
ie();
async function ie() {
  if (_()) return;
  let n = document.currentScript,
    e = L(n);
  if (!e) {
    typeof console < 'u' &&
      console.warn(
        '[HTMLRadar] missing required config (supabaseUrl, supabaseAnonKey, shareSlug). Tracker disabled.',
      );
    return;
  }
  let t = H(),
    r = O(),
    i = null,
    o;
  if (e.email) ((i = e.email), i !== r && I(i));
  else if (e.privacy.mode === 'email-gated' && e.gate.enabled)
    if (r) i = r;
    else {
      let c = v({ supabaseUrl: e.supabaseUrl, anonKey: e.supabaseAnonKey });
      ((i = await F(e, async (d) => {
        try {
          return (
            (o = await c.startSession({
              shareSlug: e.shareSlug,
              email: d,
              fingerprint: t,
              referrer: document.referrer ?? '',
              userAgent: navigator.userAgent ?? '',
              ...(e.geo ? { geo: e.geo } : {}),
            })),
            null
          );
        } catch (u) {
          return (e.debug && console.warn('[HTMLRadar] gate attempt rejected', u), ne(u));
        }
      })),
        I(i));
    }
  let s = new x({ config: e, email: i, fingerprint: t, ...(o ? { preStarted: o } : {}) }),
    a = s.start().catch((c) => {
      throw (e.debug && console.warn('[HTMLRadar] session start failed', c), c);
    });
  q({ session: s, ready: a, version: re });
}
//# sourceMappingURL=tracker.js.map
