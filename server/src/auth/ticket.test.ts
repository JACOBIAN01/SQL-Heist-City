import { describe, expect, it } from 'vitest';
import { TICKET_TTL_MS, TicketGuard, issueTicket, verifyTicket } from './ticket';

const SECRET = 'test-secret-test-secret';
const ana = { id: 7, name: 'Ana Silva' };

describe('tickets', () => {
  it('carries the player and verifies', () => {
    const result = verifyTicket(SECRET, issueTicket(SECRET, ana, 1_000_000), 1_000_500);
    expect(result).toMatchObject({ ok: true, claims: { playerId: 7, name: 'Ana Silva' } });
  });

  it('refuses another secret, a tampered body, junk and an expired ticket', () => {
    const ticket = issueTicket(SECRET, ana, 1_000_000);
    expect(verifyTicket('other-secret', ticket, 1_000_100)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    const [body, sig] = ticket.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify([99, 9_999_999, 'x', 'Evil'])).toString('base64url');
    expect(verifyTicket(SECRET, `${forged}.${sig}`, 1_000_100)).toMatchObject({
      reason: 'bad_signature',
    });
    expect(verifyTicket(SECRET, 'junk', 1_000_100)).toMatchObject({ reason: 'malformed' });
    expect(verifyTicket(SECRET, `${body}.${sig}.x`, 1_000_100)).toMatchObject({
      reason: 'malformed',
    });
    expect(verifyTicket(SECRET, ticket, 1_000_000 + TICKET_TTL_MS + 1_000)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('stays short enough for the join message, even with a long name', () => {
    const name = '语'.repeat(24);
    expect(issueTicket(SECRET, { id: 123_456, name }).length).toBeLessThan(255);
  });

  it('is accepted once by the guard and forgotten after it expires', () => {
    let now = 1_000_000;
    const guard = new TicketGuard(SECRET, () => now);
    const ticket = issueTicket(SECRET, ana, now);
    expect(guard.admit(ticket).ok).toBe(true);
    expect(guard.admit(ticket)).toEqual({ ok: false, reason: 'reused' });
    now += TICKET_TTL_MS + 1_000;
    expect(guard.admit(ticket)).toEqual({ ok: false, reason: 'expired' });
  });
});
