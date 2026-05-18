import { describe, expect, it } from 'vitest';
import { resolveRecipientIdentity } from './recipient-identity';

describe('resolveRecipientIdentity', () => {
  describe('label-driven (sender chose a label)', () => {
    it('shows label primary + first viewer email secondary with multiple viewers', () => {
      const r = resolveRecipientIdentity({ recipient_label: 'Investor list', require_email: true }, [
        { email: 'viewer2@example.test', first_seen: '2026-05-16T10:00:00Z' },
        { email: 'viewer3@example.test', first_seen: '2026-05-16T11:00:00Z' },
        { email: 'viewer4@example.test', first_seen: '2026-05-16T12:00:00Z' },
      ]);
      expect(r.primary).toBe('Investor list');
      expect(r.secondary).toBe('viewer2@example.test +2');
    });

    it('shows label primary + single viewer email secondary', () => {
      const r = resolveRecipientIdentity(
        { recipient_label: 'Marc at Example Ventures', require_email: true },
        [{ email: 'marc@example-ventures.test', first_seen: '2026-05-16T12:00:00Z' }],
      );
      expect(r.primary).toBe('Marc at Example Ventures');
      expect(r.secondary).toBe('marc@example-ventures.test');
    });

    it('shows label primary + null secondary when no viewers', () => {
      const r = resolveRecipientIdentity({ recipient_label: 'Alex', require_email: true }, []);
      expect(r.primary).toBe('Alex');
      expect(r.secondary).toBeNull();
    });

    it('shows label primary + viewer count when viewers exist but no emails captured', () => {
      const r = resolveRecipientIdentity(
        { recipient_label: 'Anonymous round', require_email: false },
        [
          { email: null, first_seen: '2026-05-16T11:00:00Z' },
          { email: null, first_seen: '2026-05-16T12:00:00Z' },
        ],
      );
      expect(r.primary).toBe('Anonymous round');
      expect(r.secondary).toBe('2 viewers');
    });

    it('suppresses secondary when label is the same email as the single viewer', () => {
      const r = resolveRecipientIdentity(
        { recipient_label: 'gf@example.com', require_email: true },
        [{ email: 'GF@example.com', first_seen: '2026-05-16T12:00:00Z' }],
      );
      expect(r.primary).toBe('GF@example.com');
      expect(r.secondary).toBeNull();
    });
  });

  describe('no-label fallback (sender did not set a label)', () => {
    it('shows first viewer email primary when emails captured', () => {
      const r = resolveRecipientIdentity({ recipient_label: null, require_email: true }, [
        { email: 'a@x.com', first_seen: '2026-05-16T11:00:00Z' },
        { email: 'b@x.com', first_seen: '2026-05-16T12:00:00Z' },
        { email: 'c@x.com', first_seen: '2026-05-16T13:00:00Z' },
      ]);
      expect(r.primary).toBe('a@x.com +2');
      expect(r.secondary).toBeNull();
    });

    it('orders viewers by first_seen so primary is the earliest opener', () => {
      const r = resolveRecipientIdentity({ recipient_label: null, require_email: true }, [
        { email: 'late@x.com', first_seen: '2026-05-16T15:00:00Z' },
        { email: 'early@x.com', first_seen: '2026-05-16T10:00:00Z' },
      ]);
      expect(r.primary).toBe('early@x.com +1');
    });

    it('falls back to "Viewer N" when no emails captured', () => {
      const r = resolveRecipientIdentity({ recipient_label: null, require_email: false }, [
        { email: null, first_seen: '2026-05-16T11:00:00Z' },
        { email: null, first_seen: '2026-05-16T12:00:00Z' },
      ]);
      expect(r.primary).toBe('Viewer 1 +1');
      expect(r.secondary).toBeNull();
    });

    it('returns "Unlabeled" when no viewers and no label', () => {
      const r = resolveRecipientIdentity({ recipient_label: null, require_email: true }, []);
      expect(r.primary).toBe('Unlabeled');
      expect(r.secondary).toBeNull();
    });

    it('falls through to Viewer N when require_email is on but viewer email not yet captured', () => {
      const r = resolveRecipientIdentity({ recipient_label: null, require_email: true }, [
        { email: '', first_seen: '2026-05-16T12:00:00Z' },
      ]);
      expect(r.primary).toBe('Viewer 1');
      expect(r.secondary).toBeNull();
    });
  });
});
