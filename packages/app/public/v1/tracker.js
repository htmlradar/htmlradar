var H = Object.defineProperty;
var F = (n, e, t) =>
  e in n ? H(n, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : (n[e] = t);
var s = (n, e, t) => (F(n, typeof e != 'symbol' ? e + '' : e, t), t);
var u = {
  sections: { selector: 'h1[id], h2[id], h3[id]', boundaryOffsetPx: 120, minDwellMs: 3e3 },
  session: { heartbeatMs: 15e3, maxSessionMinutes: 120 },
  gate: {
    enabled: !0,
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
  debug: !1,
};
function y(n) {
  let e = n ? U(n) : {},
    t = window.HTMLRadarConfig ?? {},
    i = t.supabaseUrl ?? e.supabaseUrl,
    o = t.supabaseAnonKey ?? e.supabaseAnonKey,
    a = t.shareSlug ?? e.shareSlug;
  if (!i || !o || !a) return null;
  let r = {
    supabaseUrl: i,
    supabaseAnonKey: o,
    shareSlug: a,
    sections: { ...u.sections, ...(t.sections ?? {}) },
    session: { ...u.session, ...(t.session ?? {}) },
    gate: {
      ...u.gate,
      ...(t.gate ?? {}),
      brand: { ...u.gate.brand, ...(t.gate?.brand ?? {}) },
      copy: { ...u.gate.copy, ...(t.gate?.copy ?? {}) },
    },
    privacy: { ...u.privacy, ...(t.privacy ?? {}) },
    hooks: t.hooks ?? {},
    debug: t.debug ?? !1,
  };
  return (t.email && (r.email = t.email), t.geo && (r.geo = t.geo), r);
}
function U(n) {
  let e = {};
  return (
    n.dataset.supabaseUrl && (e.supabaseUrl = n.dataset.supabaseUrl),
    n.dataset.supabaseAnonKey && (e.supabaseAnonKey = n.dataset.supabaseAnonKey),
    n.dataset.shareSlug && (e.shareSlug = n.dataset.shareSlug),
    e
  );
}
var S = 'htmlradar:',
  g = `${S}fp`,
  b = `${S}email`,
  T = `${S}optout`;
function M() {
  try {
    return localStorage.getItem(T) === '1';
  } catch {
    return !1;
  }
}
function I() {
  try {
    (localStorage.setItem(T, '1'), localStorage.removeItem(g), localStorage.removeItem(b));
  } catch {}
}
function k() {
  try {
    let n = localStorage.getItem(g);
    if (n) return n;
    let e = w();
    return (localStorage.setItem(g, e), e);
  } catch {
    return w();
  }
}
function E() {
  try {
    return localStorage.getItem(b);
  } catch {
    return null;
  }
}
function v(n) {
  try {
    localStorage.setItem(b, n);
  } catch {}
}
function w() {
  return typeof crypto < 'u' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (n) => {
        let e = (Math.random() * 16) | 0;
        return (n === 'x' ? e : (e & 3) | 8).toString(16);
      });
}
var _ = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function C(n) {
  return new Promise((e) => {
    let t = document.createElement('div');
    ((t.id = 'htmlradar-gate'),
      (t.style.cssText = 'position:fixed;inset:0;z-index:2147483647;'),
      document.body.appendChild(t));
    let i = t.attachShadow({ mode: 'closed' });
    i.innerHTML = K(n);
    let o = i.querySelector('form'),
      a = i.querySelector('input[type=email]'),
      r = i.querySelector('.error'),
      c = i.querySelector('button');
    (requestAnimationFrame(() => a.focus()),
      o.addEventListener('submit', (m) => {
        m.preventDefault();
        let l = a.value.trim().toLowerCase();
        if (!_.test(l)) {
          ((r.textContent = 'Please enter a valid email address.'),
            a.setAttribute('aria-invalid', 'true'));
          return;
        }
        ((c.disabled = !0), t.remove(), e(l));
      }));
  });
}
function K(n) {
  let e = n.gate.copy,
    t = R(n.gate.brand.accentColor, '#1a8870'),
    i = R(n.gate.brand.backgroundColor, '#faf7f1'),
    o = { accentColor: t, backgroundColor: i };
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
    <h2>${d(e.heading)}</h2>
    <p class="subhead">${d(e.subhead)}</p>
    <label for="hr-email">Email</label>
    <input id="hr-email" type="email" placeholder="${d(e.placeholder)}" required autocomplete="email" />
    <div class="error" role="alert"></div>
    <button type="submit">${d(e.buttonLabel)}</button>
    <p class="privacy">${d(e.privacyNote)}</p>
    <div class="footer">Shared with <a href="https://htmlradar.com" target="_blank" rel="noopener">HTMLRadar</a></div>
  </form>
</div>`;
}
function d(n) {
  return n
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function R(n, e) {
  return /^#[0-9a-fA-F]{3,8}$/.test(n) ||
    /^rgba?\(\s*\d+(?:\s*,\s*\d+){2}(?:\s*,\s*[\d.]+)?\s*\)$/.test(n) ||
    /^hsla?\(\s*\d+(?:\s*,\s*[\d.]+%?){2}(?:\s*,\s*[\d.]+)?\s*\)$/.test(n)
    ? n
    : e;
}
var f = class {
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
    document.querySelectorAll(this.opts.selector).forEach((t, i) => {
      t.id &&
        this.sections.push({
          id: t.id,
          title: (t.textContent ?? '').trim().slice(0, 200),
          depth: $(t.tagName),
          ordinal: i,
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
      let i = this.sections.find((o) => o.id === t);
      i && this.opts.onSectionEnter && this.opts.onSectionEnter(L(i));
    }
  }
  creditCurrent(e) {
    if (this.currentId === null || this.currentStartMs === null) return;
    let t = e - this.currentStartMs;
    if (t <= 0) return;
    let i = this.sections.find((o) => o.id === this.currentId);
    i &&
      ((i.accumulatedMs += t),
      !i.hasReadFired &&
        i.accumulatedMs >= this.opts.minDwellMs &&
        ((i.hasReadFired = !0), this.opts.onSectionRead && this.opts.onSectionRead(L(i))));
  }
  computeCurrent() {
    let e = this.opts.boundaryOffsetPx,
      t = null;
    for (let i of this.sections)
      if (i.element.getBoundingClientRect().top - e <= 0) t = i.id;
      else break;
    return t;
  }
};
function $(n) {
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
function L(n) {
  return {
    id: n.id,
    title: n.title,
    depth: n.depth,
    ordinal: n.ordinal,
    timeSeconds: n.accumulatedMs / 1e3,
  };
}
var p = class extends Error {
  constructor(t, i, o) {
    super(i);
    this.code = t;
    this.httpStatus = o;
    this.name = 'RpcError';
  }
};
function A(n) {
  let e = (r) => `${n.supabaseUrl}/rest/v1/rpc/${r}`,
    t = (r = {}) => ({
      apikey: n.anonKey,
      Authorization: `Bearer ${n.anonKey}`,
      'Content-Type': 'application/json',
      ...r,
    });
  async function i(r, c, m = !1) {
    let l = await fetch(e(r), {
      method: 'POST',
      headers: t(),
      body: JSON.stringify(c),
      keepalive: m,
    });
    if (!l.ok) {
      let x = await l.text().catch(() => ''),
        P = D(x) ?? `http_${l.status}`;
      throw new p(P, x || l.statusText, l.status);
    }
    return l.status === 204 ? null : await l.json();
  }
  async function o(r) {
    let c = await i('start_session', {
      p_share_slug: r.shareSlug,
      p_email: r.email,
      p_fingerprint: r.fingerprint,
      p_referrer: r.referrer,
      p_user_agent: r.userAgent,
      p_country_code: r.geo?.country ?? null,
      p_city: r.geo?.city ?? null,
      p_device_type: r.geo?.deviceType ?? null,
      p_os: r.geo?.os ?? null,
      p_browser: r.geo?.browser ?? null,
    });
    return {
      sessionId: c.session_id,
      token: c.token,
      documentId: c.document_id,
      documentVersion: c.document_version,
    };
  }
  async function a(r, c = !1) {
    await i(
      'update_session',
      {
        p_session_id: r.sessionId,
        p_token: r.token,
        p_active_seconds: r.activeSeconds,
        p_max_scroll: r.maxScrollDepth,
        p_sections: r.sections,
      },
      c,
    );
  }
  return { startSession: o, updateSession: a };
}
function D(n) {
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
var h = class {
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
      (this.transport = A({
        supabaseUrl: e.config.supabaseUrl,
        anonKey: e.config.supabaseAnonKey,
      })),
      (this.sections = new f({
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
    let e = await this.transport.startSession({
      shareSlug: this.opts.config.shareSlug,
      email: this.opts.email,
      fingerprint: this.opts.fingerprint,
      referrer: document.referrer ?? '',
      userAgent: navigator.userAgent ?? '',
      ...(this.opts.config.geo ? { geo: this.opts.config.geo } : {}),
    });
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
        let i = {
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
          o = this.opts.config.hooks.beforeFlush?.(i) ?? i;
        if (o === !1) return;
        (await this.transport.updateSession(o, e), (this.dirty = !1));
      } catch (t) {
        let i = t instanceof Error ? t : new Error(String(t));
        (this.opts.config.debug && console.warn('[HTMLRadar] flush failed', i),
          this.opts.config.hooks.onFlushError?.(i),
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
function O(n) {
  let e = {
    version: n.version,
    ready: n.ready,
    flush: () => n.session.flush(),
    optOut: () => {
      (I(), n.session.stop());
    },
  };
  return ((window.HTMLRadar = e), e);
}
var V = '0.1.0';
j();
async function j() {
  if (M()) return;
  let n = document.currentScript,
    e = y(n);
  if (!e) {
    typeof console < 'u' &&
      console.warn(
        '[HTMLRadar] missing required config (supabaseUrl, supabaseAnonKey, shareSlug). Tracker disabled.',
      );
    return;
  }
  let t = k(),
    i = E(),
    o = null;
  e.email
    ? ((o = e.email), o !== i && v(o))
    : e.privacy.mode === 'email-gated' &&
      e.gate.enabled &&
      ((o = i ?? (await C(e))), o !== i && v(o));
  let a = new h({ config: e, email: o, fingerprint: t }),
    r = a.start().catch((c) => {
      throw (e.debug && console.warn('[HTMLRadar] session start failed', c), c);
    });
  O({ session: a, ready: r, version: V });
}
//# sourceMappingURL=tracker.js.map
