import { describe, expect, it } from 'vitest';
import { resolveRecipientIdentity } from './recipient-identity';

describe('resolveRecipientIdentity', () => {
  it('shows viewer email as primary when email gate is on and a viewer entered an email', () => {
    const r = resolveRecipientIdentity({ recipient_label: 'Someone else', require_email: true }, [
      { email: 'gf@example.com', first_seen: '2026-05-16T12:00:00Z' },
    ]);
    expect(r.primary).toBe('gf@example.com');
    expect(r.secondary).toBe('Someone else');
  });

  it('keeps secondary null when the sender label matches the viewer email case-insensitively', () => {
    const r = resolveRecipientIdentity({ recipient_label: 'gf@example.com', require_email: true }, [
      { email: 'GF@example.com', first_seen: '2026-05-16T12:00:00Z' },
    ]);
    expect(r.primary).toBe('GF@example.com');
    expect(r.secondary).toBeNull();
  });

  it('shows "first +N" when multiple viewers entered emails', () => {
    const r = resolveRecipientIdentity({ recipient_label: null, require_email: true }, [
      { email: 'a@x.com', first_seen: '2026-05-16T11:00:00Z' },
      { email: 'b@x.com', first_seen: '2026-05-16T12:00:00Z' },
      { email: 'c@x.com', first_seen: '2026-05-16T13:00:00Z' },
    ]);
    expect(r.primary).toBe('a@x.com +2');
    expect(r.secondary).toBeNull();
  });

  it('orders viewers by first_seen so the displayed email is the first opener', () => {
    const r = resolveRecipientIdentity({ recipient_label: null, require_email: true }, [
      { email: 'late@x.com', first_seen: '2026-05-16T15:00:00Z' },
      { email: 'early@x.com', first_seen: '2026-05-16T10:00:00Z' },
    ]);
    expect(r.primary).toBe('early@x.com +1');
  });

  it('falls back to "Viewer N" when viewers exist but none have an email', () => {
    const r = resolveRecipientIdentity(
      { recipient_label: 'Marc at Example Ventures', require_email: false },
      [
        { email: null, first_seen: '2026-05-16T11:00:00Z' },
        { email: null, first_seen: '2026-05-16T12:00:00Z' },
      ],
    );
    expect(r.primary).toBe('Viewer 1 +1');
    expect(r.secondary).toBe('Marc at Example Ventures');
  });

  it('returns the label as primary when no viewers exist', () => {
    const r = resolveRecipientIdentity({ recipient_label: 'Alex', require_email: true }, []);
    expect(r.primary).toBe('Alex');
    expect(r.secondary).toBeNull();
  });

  it('returns "Unlabeled" when no viewers and no label', () => {
    const r = resolveRecipientIdentity({ recipient_label: null, require_email: true }, []);
    expect(r.primary).toBe('Unlabeled');
    expect(r.secondary).toBeNull();
  });

  it('falls through to Viewer N when require_email is on but viewers have no email yet', () => {
    // require_email gate is on; viewer row exists (created at gate submit)
    // but no email captured (could happen during the small gap before
    // proxy writes email into viewers row). Should not crash.
    const r = resolveRecipientIdentity({ recipient_label: null, require_email: true }, [
      { email: '', first_seen: '2026-05-16T12:00:00Z' },
    ]);
    expect(r.primary).toBe('Viewer 1');
    expect(r.secondary).toBeNull();
  });
});
