import { describe, expect, it } from 'vitest';
import { resolveRecipientIdentity } from './recipient-identity';

describe('resolveRecipientIdentity', () => {
  describe('label-driven (sender chose a label)', () => {
    it('shows label primary + first viewer email secondary with multiple viewers', () => {
      const r = resolveRecipientIdentity(
        { recipient_label: 'Investor list', require_email: true },
        [
          { email: 'ana@example.test', first_seen: '2026-01-01T10:00:00Z' },
          { email: 'ben@example.test', first_seen: '2026-01-01T11:00:00Z' },
          { email: 'cai@example.test', first_seen: '2026-01-01T12:00:00Z' },
        ],
      );
      expect(r.primary).toBe('Investor list');
      expect(r.secondary).toBe('ana@example.test +2');
    });

    it('shows label primary + single viewer email secondary', () => {
      const r = resolveRecipientIdentity(
        { recipient_label: 'Marc at Example Ventures', require_email: true },
        [{ email: 'marc@example.com', first_seen: '2026-01-01T12:00:00Z' }],
      );
      expect(r.primary).toBe('Marc at Example Ventures');
      expect(r.secondary).toBe('marc@example.com');
    });

    it('shows label primary + null secondary when no viewers', () => {
      const r = resolveRecipientIdentity({ recipient_label: 'Sam', require_email: true }, []);
      expect(r.primary).toBe('Sam');
      expect(r.secondary).toBeNull();
    });

    it('shows label primary + viewer count when viewers exist but no emails captured', () => {
      const r = resolveRecipientIdentity(
        { recipient_label: 'Anonymous round', require_email: false },
        [
          { email: null, first_seen: '2026-01-01T11:00:00Z' },
          { email: null, first_seen: '2026-01-01T12:00:00Z' },
        ],
      );
      expect(r.primary).toBe('Anonymous round');
      expect(r.secondary).toBe('2 viewers');
    });

    it('suppresses secondary when label is the same email as the single viewer', () => {
      const r = resolveRecipientIdentity(
        { recipient_label: 'gf@example.com', require_email: true },
        [{ email: 'GF@example.com', first_seen: '2026-01-01T12:00:00Z' }],
      );
      expect(r.primary).toBe('GF@example.com');
      expect(r.secondary).toBeNull();
    });
  });

  describe('no-label fallback (sender did not set a label)', () => {
    it('shows first viewer email primary when emails captured', () => {
      const r = resolveRecipientIdentity({ recipient_label: null, require_email: true }, [
        { email: 'a@example.com', first_seen: '2026-01-01T11:00:00Z' },
        { email: 'b@example.com', first_seen: '2026-01-01T12:00:00Z' },
        { email: 'c@example.com', first_seen: '2026-01-01T13:00:00Z' },
      ]);
      expect(r.primary).toBe('a@example.com +2');
      expect(r.secondary).toBeNull();
    });

    it('orders viewers by first_seen so primary is the earliest opener', () => {
      const r = resolveRecipientIdentity({ recipient_label: null, require_email: true }, [
        { email: 'late@example.com', first_seen: '2026-01-01T15:00:00Z' },
        { email: 'early@example.com', first_seen: '2026-01-01T10:00:00Z' },
      ]);
      expect(r.primary).toBe('early@example.com +1');
    });

    it('falls back to "Viewer N" when no emails captured', () => {
      const r = resolveRecipientIdentity({ recipient_label: null, require_email: false }, [
        { email: null, first_seen: '2026-01-01T11:00:00Z' },
        { email: null, first_seen: '2026-01-01T12:00:00Z' },
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
        { email: '', first_seen: '2026-01-01T12:00:00Z' },
      ]);
      expect(r.primary).toBe('Viewer 1');
      expect(r.secondary).toBeNull();
    });
  });
});
