import type { FlushPayload, SectionInfo, SessionInfo, TrackerConfig } from './types.js';
// v2: viewport-coverage-weighted accumulation (post-mortem 2026-05-17).
// One-line rollback: change this import to `./sections-legacy.js`. The
// legacy file ships in the bundle until 2026-05-24 once v2 is stable.
import { SectionTracker } from './sections-v2.js';
import { createTransport, RpcError, type StartSessionResult } from './transport.js';

interface SessionOptions {
  config: TrackerConfig;
  email: string | null;
  fingerprint: string;
  // When the email gate already called start_session (so it could surface
  // server-side rejections in the gate UI), this is the result. Session
  // installs it directly and skips its own RPC — preventing duplicate
  // session rows + duplicate first-read emails.
  preStarted?: StartSessionResult;
}

// Owns the lifecycle: starts the session, runs the heartbeat, tracks scroll
// depth + active time, flushes on visibility-hidden / pagehide.
//
// The flushing mutex is the answer to audit F-11: heartbeat and unload
// handlers can race; without a mutex we get duplicate UPSERTs. With the
// mutex (+ the DB-side `unique(session_id, section_id)`), they queue.
export class Session {
  private readonly opts: SessionOptions;
  private readonly transport: ReturnType<typeof createTransport>;
  private readonly sections: SectionTracker;

  private info: SessionInfo | null = null;
  private token: string | null = null;

  private activeMs = 0;
  private activeRunningSince: number | null = null;
  private maxScroll = 0;

  private heartbeatTimer: number | null = null;
  private maxSessionTimer: number | null = null;

  private flushing = false;
  private dirty = false;
  private rafScrollScheduled = false;
  private boundCount = 0;

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.transport = createTransport({
      supabaseUrl: opts.config.supabaseUrl,
      anonKey: opts.config.supabaseAnonKey,
    });
    this.sections = new SectionTracker({
      selector: opts.config.sections.selector,
      boundaryOffsetPx: opts.config.sections.boundaryOffsetPx,
      minDwellMs: opts.config.sections.minDwellMs,
      ...(opts.config.hooks.onSectionEnter
        ? { onSectionEnter: opts.config.hooks.onSectionEnter }
        : {}),
      ...(opts.config.hooks.onSectionRead
        ? { onSectionRead: opts.config.hooks.onSectionRead }
        : {}),
    });
  }

  async start(): Promise<SessionInfo | null> {
    // ---------------------------------------------------------------
    // Bot / accidental-tap filter
    // ---------------------------------------------------------------
    // When the email gate already created a session server-side (the
    // recipient typed an email + clicked Continue — a strong "real
    // human" signal), there's no warm-up wait: we install the
    // pre-started session immediately.
    //
    // For every OTHER path — anonymous shares, allow-listed pre-auth,
    // returning recipients with localStorage'd email — we hold for 5s
    // before creating the session row. If the recipient bounced or
    // backgrounded the tab during the wait, we skip session creation
    // entirely. Stops link-preview crawlers, accidental clicks, and
    // 1-second mis-opens from inflating viewer counts and triggering
    // owner-notification emails.
    //
    // Listener binding is deferred until AFTER the warm-up so a bounce
    // during the wait leaves nothing to clean up.
    if (!this.opts.preStarted) {
      if (document.hidden) return null;
      const SESSION_DELAY_MS = 5000;
      await new Promise<void>((resolve) => setTimeout(resolve, SESSION_DELAY_MS));
      if (document.hidden) return null;
    }

    if (!document.hidden) {
      this.activeRunningSince = performance.now();
    }
    this.bindListeners();
    this.sections.start();
    this.updateMaxScroll();

    const result =
      this.opts.preStarted ??
      (await this.transport.startSession({
        shareSlug: this.opts.config.shareSlug,
        email: this.opts.email,
        fingerprint: this.opts.fingerprint,
        referrer: document.referrer ?? '',
        userAgent: navigator.userAgent ?? '',
        ...(this.opts.config.geo ? { geo: this.opts.config.geo } : {}),
      }));

    this.info = {
      sessionId: result.sessionId,
      documentId: result.documentId,
      documentVersion: result.documentVersion,
    };
    this.token = result.token;

    this.startTimers();
    if (this.opts.config.hooks.onSessionStart) {
      this.opts.config.hooks.onSessionStart(this.info);
    }
    return this.info;
  }

  async flush(keepalive = false): Promise<void> {
    if (this.flushing || !this.info || !this.token) return;
    this.flushing = true;
    try {
      this.tickActive(performance.now());
      // Poll scroll position on every flush. The scroll-listener path
      // covers normal scrolling, but smooth-scroll libraries and mobile
      // momentum scrolls sometimes leave events un-fired while position
      // does change — polling here makes max_scroll_depth eventually
      // consistent with reality regardless of event firing.
      this.updateMaxScroll();
      const sections: SectionInfo[] = this.sections.snapshot();
      if (sections.length === 0 && !this.dirty) {
        // Nothing changed and no sections to send.
        return;
      }
      const payload: FlushPayload = {
        sessionId: this.info.sessionId,
        token: this.token,
        activeSeconds: Math.round(this.activeMs / 1000),
        maxScrollDepth: this.maxScroll,
        sections: sections.map((s) => ({
          section_id: s.id,
          section_title: s.title,
          depth: s.depth,
          ordinal: s.ordinal,
          time_seconds: s.timeSeconds,
        })),
      };
      const transformed = this.opts.config.hooks.beforeFlush?.(payload) ?? payload;
      if (transformed === false) return;
      await this.transport.updateSession(transformed, keepalive);
      this.dirty = false;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (this.opts.config.debug) {
        // eslint-disable-next-line no-console
        console.warn('[HTMLRadar] flush failed', error);
      }
      this.opts.config.hooks.onFlushError?.(error);
      if (err instanceof RpcError && err.code === 'P0010') {
        // Invalid token — session no longer valid; stop trying.
        this.stop();
      }
    } finally {
      this.flushing = false;
    }
  }

  stop(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.maxSessionTimer !== null) {
      clearTimeout(this.maxSessionTimer);
      this.maxSessionTimer = null;
    }
    this.sections.stop();
    this.unbindListeners();
  }

  // --- internals ---

  private startTimers(): void {
    this.heartbeatTimer = window.setInterval(
      () => void this.flush(),
      this.opts.config.session.heartbeatMs,
    );
    this.maxSessionTimer = window.setTimeout(
      () => this.stop(),
      this.opts.config.session.maxSessionMinutes * 60_000,
    );
  }

  private bindListeners(): void {
    if (this.boundCount > 0) return;
    this.boundCount = 1;
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('scroll', this.onScroll, { passive: true });
  }

  private unbindListeners(): void {
    if (this.boundCount === 0) return;
    this.boundCount = 0;
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('scroll', this.onScroll);
  }

  private onVisibility = (): void => {
    if (document.hidden) {
      this.tickActive(performance.now());
      this.activeRunningSince = null;
      this.sections.pause();
      void this.flush();
    } else {
      this.activeRunningSince = performance.now();
      this.sections.resume();
    }
  };

  private onPageHide = (): void => {
    this.tickActive(performance.now());
    this.activeRunningSince = null;
    this.sections.pause();
    void this.flush(true);
  };

  private onScroll = (): void => {
    if (this.rafScrollScheduled) return;
    this.rafScrollScheduled = true;
    requestAnimationFrame(() => {
      this.rafScrollScheduled = false;
      this.updateMaxScroll();
    });
  };

  private updateMaxScroll(): void {
    const docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    if (docHeight <= 0) {
      // Single-viewport doc — they saw all of it.
      if (this.maxScroll < 1) {
        this.maxScroll = 1;
        this.dirty = true;
      }
      return;
    }
    // Robust scroll-position read: some mobile browsers / smooth-scroll
    // libraries (Lenis) leave `window.scrollY` stale while
    // `documentElement.scrollTop` updates, and vice versa on iOS Safari
    // during momentum scrolls. Take the larger of the two so we don't
    // silently report 0% on a deck where one of them isn't moving.
    const scrolledPx = Math.max(
      window.scrollY || 0,
      document.documentElement.scrollTop || 0,
      document.body.scrollTop || 0,
    );
    const ratio = Math.max(0, Math.min(1, scrolledPx / docHeight));
    if (ratio > this.maxScroll) {
      this.maxScroll = ratio;
      this.dirty = true;
    }
  }

  private tickActive(nowMs: number): void {
    if (this.activeRunningSince === null) return;
    const elapsed = nowMs - this.activeRunningSince;
    if (elapsed > 0) {
      this.activeMs += elapsed;
      this.dirty = true;
    }
    this.activeRunningSince = nowMs;
  }
}
