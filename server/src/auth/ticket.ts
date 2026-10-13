import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** What a game ticket says: who is joining. */
export interface TicketClaims {
  readonly playerId: number;
  readonly name: string;
  /** Expiry, ms since epoch. */
  readonly expiresAt: number;
  /** Random id, so a ticket can be used once. */
  readonly jti: string;
}

export type TicketFailure = 'malformed' | 'bad_signature' | 'expired' | 'reused';

export const TICKET_TTL_MS = 60_000;

const sign = (secret: string, body: string) =>
  createHmac('sha256', secret).update(body).digest('base64url');

/**
 * A compact signed token the account service hands to a signed-in player and
 * the game server checks locally: `base64url([id, exp, jti, name]).signature`.
 * No database call on the join path (docs/identity.md).
 */
export function issueTicket(
  secret: string,
  player: { id: number; name: string },
  now = Date.now(),
  ttlMs = TICKET_TTL_MS,
): string {
  const jti = randomBytes(6).toString('base64url');
  const body = Buffer.from(
    JSON.stringify([player.id, Math.floor((now + ttlMs) / 1000), jti, player.name]),
  ).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

export function verifyTicket(
  secret: string,
  ticket: string,
  now = Date.now(),
): { ok: true; claims: TicketClaims } | { ok: false; reason: TicketFailure } {
  const [body, signature, extra] = ticket.split('.');
  if (!body || !signature || extra !== undefined) return { ok: false, reason: 'malformed' };
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return { ok: false, reason: 'bad_signature' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 4 ||
    !Number.isInteger(parsed[0]) ||
    !Number.isInteger(parsed[1]) ||
    typeof parsed[2] !== 'string' ||
    typeof parsed[3] !== 'string'
  )
    return { ok: false, reason: 'malformed' };
  const [playerId, exp, jti, name] = parsed as [number, number, string, string];
  if (exp * 1000 <= now) return { ok: false, reason: 'expired' };
  return { ok: true, claims: { playerId, name, expiresAt: exp * 1000, jti } };
}

/**
 * Accepts each ticket once. Remembers a ticket's id only until it would have
 * expired anyway, so memory stays small.
 */
export class TicketGuard {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {}

  admit(ticket: string): { ok: true; claims: TicketClaims } | { ok: false; reason: TicketFailure } {
    const now = this.now();
    for (const [id, until] of this.seen) if (until <= now) this.seen.delete(id);
    const result = verifyTicket(this.secret, ticket, now);
    if (!result.ok) return result;
    if (this.seen.has(result.claims.jti)) return { ok: false, reason: 'reused' };
    this.seen.set(result.claims.jti, result.claims.expiresAt);
    return result;
  }
}
