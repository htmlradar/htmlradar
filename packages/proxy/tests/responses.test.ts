import { describe, expect, it } from 'vitest';
import {
  notFound,
  revoked,
  expired,
  sourceUnreachable,
  emailGateForm,
  passwordForm,
} from '../src/responses.js';

// Recipient-facing shells get rewritten relatively often (copy, colors,
// micro-affordances). These assertions lock in the Batch D contract so a
// future refactor can't silently drop the warm copy + "Reply to sender"
// affordance + "What is HTMLRadar?" link. They also guard against any
// HTTP code (403/404/410) accidentally leaking back into the visible
// body — the post-Batch-D rule is "no HTTP codes shown to recipients."

async function bodyOf(res: Response): Promise<string> {
  return await res.text();
}

const HTTP_CODE_REGEX = /\b(401|403|404|410|418|500|502|503)\b/;

describe('recipient error shells (Batch D)', () => {
  describe('status codes preserved', () => {
    it('notFound returns 404', () => {
      expect(notFound().status).toBe(404);
    });
    it('revoked returns 403', () => {
      expect(revoked().status).toBe(403);
    });
    it('expired returns 410', () => {
      expect(expired().status).toBe(410);
    });
    it('sourceUnreachable returns 502', () => {
      expect(sourceUnreachable().status).toBe(502);
    });
  });

  describe('no HTTP codes in visible body', () => {
    it.each([
      ['notFound', notFound],
      ['revoked', revoked],
      ['expired', expired],
      ['sourceUnreachable', sourceUnreachable],
    ])('%s body has no HTTP status numbers', async (_name, fn) => {
      const body = await bodyOf(fn());
      // Strip <head> and any meta tags before matching — the body can
      // legitimately reference numeric IDs (font weights, RGB) we don't
      // care about. Look only at user-visible <main>/<h1>/<p> content.
      const visibleOnly = body.replace(/<head[\s\S]*?<\/head>/i, '');
      expect(visibleOnly).not.toMatch(HTTP_CODE_REGEX);
    });
  });

  describe('ERROR_FOOTER affordances on every error shell', () => {
    it.each([
      ['notFound', notFound],
      ['revoked', revoked],
      ['expired', expired],
      ['sourceUnreachable', sourceUnreachable],
    ])('%s includes "Reply to the person" cue', async (_name, fn) => {
      const body = await bodyOf(fn());
      expect(body).toContain('Reply to the person who sent this to you');
    });

    it.each([
      ['notFound', notFound],
      ['revoked', revoked],
      ['expired', expired],
      ['sourceUnreachable', sourceUnreachable],
    ])('%s includes "What is HTMLRadar?" link to htmlradar.com', async (_name, fn) => {
      const body = await bodyOf(fn());
      expect(body).toContain('What is HTMLRadar?');
      expect(body).toContain('https://htmlradar.com');
    });
  });

  describe('warm-copy headlines (Batch D rewrite)', () => {
    it('notFound headline', async () => {
      expect(await bodyOf(notFound())).toContain("doesn't open anything");
    });
    it('revoked headline', async () => {
      expect(await bodyOf(revoked())).toContain('turned this link off');
    });
    it('expired headline', async () => {
      expect(await bodyOf(expired())).toContain("link's window has closed");
    });
    it('sourceUnreachable headline', async () => {
      expect(await bodyOf(sourceUnreachable())).toContain("document didn't load");
    });
  });

  describe('cache headers — error shells must not be edge-cached', () => {
    it.each([
      ['notFound', notFound],
      ['revoked', revoked],
      ['expired', expired],
      ['sourceUnreachable', sourceUnreachable],
    ])('%s sends no-store', (_name, fn) => {
      const cc = fn().headers.get('Cache-Control') ?? '';
      expect(cc).toMatch(/no-store/);
    });
  });

  describe('gate forms still work', () => {
    it('emailGateForm includes the POST target', async () => {
      expect(await bodyOf(emailGateForm('abc-123'))).toContain('action="/r/abc-123/email"');
    });
    it('passwordForm includes the POST target', async () => {
      expect(await bodyOf(passwordForm('xyz-789'))).toContain('action="/r/xyz-789/auth"');
    });
  });

  // The tracking disclosure belongs to the email gate alone: that is the one
  // screen where the recipient hands over an identity. The document itself is
  // built by fetch-html + inject and never passes through this module, so it
  // cannot pick the sentence up.
  describe('tracking disclosure on the email gate only', () => {
    const DISCLOSURE = 'Reading activity on this document is shared with the sender.';

    it('emailGateForm shows the disclosure and the privacy link', async () => {
      const body = await bodyOf(emailGateForm('abc-123'));
      expect(body).toContain(DISCLOSURE);
      expect(body).toContain('href="https://htmlradar.com/privacy"');
      expect(body).toContain('How HTMLRadar handles this');
    });

    it.each([
      ['passwordForm', () => passwordForm('xyz-789')],
      ['notFound', notFound],
      ['revoked', revoked],
      ['expired', expired],
      ['sourceUnreachable', sourceUnreachable],
    ])('%s does not show the disclosure', async (_name, fn) => {
      expect(await bodyOf(fn())).not.toContain(DISCLOSURE);
    });
  });
});
