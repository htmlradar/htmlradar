var K = Object.defineProperty;
var $ = (n, e, t) =>
  e in n ? K(n, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : (n[e] = t);
var s = (n, e, t) => ($(n, typeof e != 'symbol' ? e + '' : e, t), t);
var h = {
  sections: { selector: 'h1[id], h2[id], h3[id]', boundaryOffsetPx: 120, minDwellMs: 3e3 },
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
function M(n) {
  let e = n ? D(n) : {},
    t = window.HTMLRadarConfig ?? {},
    r = t.supabaseUrl ?? e.supabaseUrl,
    o = t.supabaseAnonKey ?? e.supabaseAnonKey,
    a = t.shareSlug ?? e.shareSlug;
  if (!r || !o || !a) return null;
  let i = {
    supabaseUrl: r,
    supabaseAnonKey: o,
    shareSlug: a,
    sections: { ...h.sections, ...(t.sections ?? {}) },
    session: { ...h.session, ...(t.session ?? {}) },
    gate: {
      ...h.gate,
      ...(t.gate ?? {}),
      brand: { ...h.gate.brand, ...(t.gate?.brand ?? {}) },
      copy: { ...h.gate.copy, ...(t.gate?.copy ?? {}) },
    },
    privacy: { ...h.privacy, ...(t.privacy ?? {}) },
    hooks: t.hooks ?? {},
    debug: t.debug ?? !1,
  };
  return (t.email && (i.email = t.email), t.geo && (i.geo = t.geo), i);
}
function D(n) {
  let e = {};
  return (
    n.dataset.supabaseUrl && (e.supabaseUrl = n.dataset.supabaseUrl),
    n.dataset.supabaseAnonKey && (e.supabaseAnonKey = n.dataset.supabaseAnonKey),
    n.dataset.shareSlug && (e.shareSlug = n.dataset.shareSlug),
    e
  );
}
var T = 'htmlradar:',
  w = `${T}fp`,
  k = `${T}email`,
  C = `${T}optout`;
function _() {
  try {
    return localStorage.getItem(C) === '1';
  } catch {
    return !1;
  }
}
function R() {
  try {
    (localStorage.setItem(C, '1'), localStorage.removeItem(w), localStorage.removeItem(k));
  } catch {}
}
function A() {
  try {
    let n = localStorage.getItem(w);
    if (n) return n;
    let e = I();
    return (localStorage.setItem(w, e), e);
  } catch {
    return I();
  }
}
function L() {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function E(n) {
  try {
    localStorage.setItem(k, n);
  } catch {}
}
function I() {
  return typeof crypto < 'u' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (n) => {
        let e = (Math.random() * 16) | 0;
        return (n === 'x' ? e : (e & 3) | 8).toString(16);
      });
}
var P = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function H(n, e) {
  return new Promise((t) => {
    let r = document.createElement('div');
    ((r.id = 'htmlradar-gate'),
      (r.style.cssText = 'position:fixed;inset:0;z-index:2147483647;'),
      document.body.appendChild(r));
    let o = r.attachShadow({ mode: 'closed' });
    o.innerHTML = j(n);
    let a = o.querySelector('form'),
      i = o.querySelector('input[type=email]'),
      c = o.querySelector('.error'),
      l = o.querySelector('button'),
      u = l.textContent ?? 'Continue';
    requestAnimationFrame(() => i.focus());
    let d = (y) => {
        ((c.textContent = y), i.setAttribute('aria-invalid', 'true'));
      },
      m = () => {
        ((c.textContent = ''), i.removeAttribute('aria-invalid'));
      };
    (i.addEventListener('input', m),
      a.addEventListener('submit', async (y) => {
        y.preventDefault();
        let x = i.value.trim().toLowerCase();
        if (!P.test(x)) {
          d('Please enter a valid email address.');
          return;
        }
        ((l.disabled = !0), (l.textContent = 'Loading\u2026'), m());
        let g;
        try {
          g = await e(x);
        } catch {
          g = "We couldn't reach the server. Check your connection and try again.";
        }
        if (g) {
          ((l.disabled = !1), (l.textContent = u), d(g));
          return;
        }
        (r.remove(), t(x));
      }));
  });
}
function j(n) {
  let e = n.gate.copy,
    t = O(n.gate.brand.accentColor, '#1a8870'),
    r = O(n.gate.brand.backgroundColor, '#faf7f1'),
    o = { accentColor: t, backgroundColor: r };
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
    background: ${o.backgroundColor};
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
  input[type=email]:focus { border-color: ${o.accentColor}; }
  input[aria-invalid="true"] { border-color: #b35314; }
  .error { color: #b35314; font-size: 13px; min-height: 18px; margin-top: 6px; }
  button {
    margin-top: 16px;
    width: 100%;
    padding: 11px 16px;
    background: ${o.accentColor};
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
    <h2>${f(e.heading)}</h2>
    <p class="subhead">${f(e.subhead)}</p>
    <label for="hr-email">Email</label>
    <input id="hr-email" type="email" placeholder="${f(e.placeholder)}" required autocomplete="email" />
    <div class="error" role="alert"></div>
    <button type="submit">${f(e.buttonLabel)}</button>
    <p class="privacy">${f(e.privacyNote)}</p>
    <div class="footer">Shared with <a href="https://htmlradar.com" target="_blank" rel="noopener">HTMLRadar</a></div>
  </form>
</div>`;
}
function f(n) {
  return n
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function O(n, e) {
  return /^#[0-9a-fA-F]{3,8}$/.test(n) ||
    /^rgba?\(\s*\d+(?:\s*,\s*\d+){2}(?:\s*,\s*[\d.]+)?\s*\)$/.test(n) ||
    /^hsla?\(\s*\d+(?:\s*,\s*[\d.]+%?){2}(?:\s*,\s*[\d.]+)?\s*\)$/.test(n)
    ? n
    : e;
}
var S = class {
  constructor(e) {
    s(this, 'opts');
    s(this, 'sections', []);
    s(this, 'currentId', null);
    s(this, 'currentStartMs', null);
    s(this, 'rafScheduled', !1);
    s(this, 'active', !1);
    s(this, 'onScroll', () => {
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
      window.addEventListener('scroll', this.onScroll, { passive: !0 }),
      this.update(performance.now()));
  }
  stop() {
    this.active &&
      ((this.active = !1),
      this.creditCurrent(performance.now()),
      window.removeEventListener('scroll', this.onScroll));
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
    document.querySelectorAll(this.opts.selector).forEach((t, r) => {
      t.id &&
        this.sections.push({
          id: t.id,
          title: (t.textContent ?? '').trim().slice(0, 200),
          depth: q(t.tagName),
          ordinal: r,
          element: t,
          accumulatedMs: 0,
          hasReadFired: !1,
        });
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
      let r = this.sections.find((o) => o.id === t);
      r && this.opts.onSectionEnter && this.opts.onSectionEnter(F(r));
    }
  }
  creditCurrent(e) {
    if (this.currentId === null || this.currentStartMs === null) return;
    let t = e - this.currentStartMs;
    if (t <= 0) return;
    let r = this.sections.find((o) => o.id === this.currentId);
    r &&
      ((r.accumulatedMs += t),
      !r.hasReadFired &&
        r.accumulatedMs >= this.opts.minDwellMs &&
        ((r.hasReadFired = !0), this.opts.onSectionRead && this.opts.onSectionRead(F(r))));
  }
  computeCurrent() {
    let e = this.opts.boundaryOffsetPx,
      t = null;
    for (let r of this.sections)
      if (r.element.getBoundingClientRect().top - e <= 0) t = r.id;
      else break;
    return t;
  }
};
function q(n) {
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
function F(n) {
  return {
    id: n.id,
    title: n.title,
    depth: n.depth,
    ordinal: n.ordinal,
    timeSeconds: n.accumulatedMs / 1e3,
  };
}
var p = class extends Error {
  constructor(t, r, o) {
    super(r);
    this.code = t;
    this.httpStatus = o;
    this.name = 'RpcError';
  }
};
function b(n) {
  let e = (i) => `${n.supabaseUrl}/rest/v1/rpc/${i}`,
    t = (i = {}) => ({
      apikey: n.anonKey,
      Authorization: `Bearer ${n.anonKey}`,
      'Content-Type': 'application/json',
      ...i,
    });
  async function r(i, c, l = !1) {
    let u = await fetch(e(i), {
      method: 'POST',
      headers: t(),
      body: JSON.stringify(c),
      keepalive: l,
    });
    if (!u.ok) {
      let d = await u.text().catch(() => ''),
        m = z(d) ?? `http_${u.status}`;
      throw new p(m, d || u.statusText, u.status);
    }
    return u.status === 204 ? null : await u.json();
  }
  async function o(i) {
    let c = await r('start_session', {
      p_share_slug: i.shareSlug,
      p_email: i.email,
      p_fingerprint: i.fingerprint,
      p_referrer: i.referrer,
      p_user_agent: i.userAgent,
      p_country_code: i.geo?.country ?? null,
      p_city: i.geo?.city ?? null,
      p_device_type: i.geo?.deviceType ?? null,
      p_os: i.geo?.os ?? null,
      p_browser: i.geo?.browser ?? null,
    });
    return {
      sessionId: c.session_id,
      token: c.token,
      documentId: c.document_id,
      documentVersion: c.document_version,
    };
  }
  async function a(i, c = !1) {
    await r(
      'update_session',
      {
        p_session_id: i.sessionId,
        p_token: i.token,
        p_active_seconds: i.activeSeconds,
        p_max_scroll: i.maxScrollDepth,
        p_sections: i.sections,
      },
      c,
    );
  }
  return { startSession: o, updateSession: a };
}
function z(n) {
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
var v = class {
  constructor(e) {
    s(this, 'opts');
    s(this, 'transport');
    s(this, 'sections');
    s(this, 'info', null);
    s(this, 'token', null);
    s(this, 'activeMs', 0);
    s(this, 'activeRunningSince', null);
    s(this, 'maxScroll', 0);
    s(this, 'heartbeatTimer', null);
    s(this, 'maxSessionTimer', null);
    s(this, 'flushing', !1);
    s(this, 'dirty', !1);
    s(this, 'rafScrollScheduled', !1);
    s(this, 'boundCount', 0);
    s(this, 'onVisibility', () => {
      document.hidden
        ? (this.tickActive(performance.now()),
          (this.activeRunningSince = null),
          this.sections.pause(),
          this.flush())
        : ((this.activeRunningSince = performance.now()), this.sections.resume());
    });
    s(this, 'onPageHide', () => {
      (this.tickActive(performance.now()),
        (this.activeRunningSince = null),
        this.sections.pause(),
        this.flush(!0));
    });
    s(this, 'onScroll', () => {
      this.rafScrollScheduled ||
        ((this.rafScrollScheduled = !0),
        requestAnimationFrame(() => {
          ((this.rafScrollScheduled = !1), this.updateMaxScroll());
        }));
    });
    ((this.opts = e),
      (this.transport = b({
        supabaseUrl: e.config.supabaseUrl,
        anonKey: e.config.supabaseAnonKey,
      })),
      (this.sections = new S({
        selector: e.config.sections.selector,
        boundaryOffsetPx: e.config.sections.boundaryOffsetPx,
        minDwellMs: e.config.sections.minDwellMs,
        ...(e.config.hooks.onSectionEnter ? { onSectionEnter: e.config.hooks.onSectionEnter } : {}),
        ...(e.config.hooks.onSectionRead ? { onSectionRead: e.config.hooks.onSectionRead } : {}),
      })));
  }
  async start() {
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
        this.tickActive(performance.now());
        let t = this.sections.snapshot();
        if (t.length === 0 && !this.dirty) return;
        let r = {
            sessionId: this.info.sessionId,
            token: this.token,
            activeSeconds: Math.round(this.activeMs / 1e3),
            maxScrollDepth: this.maxScroll,
            sections: t.map((a) => ({
              section_id: a.id,
              section_title: a.title,
              depth: a.depth,
              ordinal: a.ordinal,
              time_seconds: a.timeSeconds,
            })),
          },
          o = this.opts.config.hooks.beforeFlush?.(r) ?? r;
        if (o === !1) return;
        (await this.transport.updateSession(o, e), (this.dirty = !1));
      } catch (t) {
        let r = t instanceof Error ? t : new Error(String(t));
        (this.opts.config.debug && console.warn('[HTMLRadar] flush failed', r),
          this.opts.config.hooks.onFlushError?.(r),
          t instanceof p && t.code === 'P0010' && this.stop());
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
    let t = Math.max(0, Math.min(1, window.scrollY / e));
    t > this.maxScroll && ((this.maxScroll = t), (this.dirty = !0));
  }
  tickActive(e) {
    if (this.activeRunningSince === null) return;
    let t = e - this.activeRunningSince;
    (t > 0 && ((this.activeMs += t), (this.dirty = !0)), (this.activeRunningSince = e));
  }
};
function U(n) {
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
function V(n) {
  if (n instanceof p)
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
var N = '0.1.0';
G();
async function G() {
  if (_()) return;
  let n = document.currentScript,
    e = M(n);
  if (!e) {
    typeof console < 'u' &&
      console.warn(
        '[HTMLRadar] missing required config (supabaseUrl, supabaseAnonKey, shareSlug). Tracker disabled.',
      );
    return;
  }
  let t = A(),
    r = L(),
    o = null,
    a;
  if (e.email) ((o = e.email), o !== r && E(o));
  else if (e.privacy.mode === 'email-gated' && e.gate.enabled)
    if (r) o = r;
    else {
      let l = b({ supabaseUrl: e.supabaseUrl, anonKey: e.supabaseAnonKey });
      ((o = await H(e, async (u) => {
        try {
          return (
            (a = await l.startSession({
              shareSlug: e.shareSlug,
              email: u,
              fingerprint: t,
              referrer: document.referrer ?? '',
              userAgent: navigator.userAgent ?? '',
              ...(e.geo ? { geo: e.geo } : {}),
            })),
            null
          );
        } catch (d) {
          return (e.debug && console.warn('[HTMLRadar] gate attempt rejected', d), V(d));
        }
      })),
        E(o));
    }
  let i = new v({ config: e, email: o, fingerprint: t, ...(a ? { preStarted: a } : {}) }),
    c = i.start().catch((l) => {
      throw (e.debug && console.warn('[HTMLRadar] session start failed', l), l);
    });
  U({ session: i, ready: c, version: N });
}
//# sourceMappingURL=tracker.js.map
