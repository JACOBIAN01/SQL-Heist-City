import { TicketGuard } from '../auth/ticket';

/** Who is joining, as far as the server can prove. */
export type JoinVerdict =
  | { readonly ok: true; readonly identity?: { readonly playerId: number; readonly name: string } }
  | { readonly ok: false; readonly reason: string };

// SOLID: D — Why: the socket asks "may this join?" of a policy it is given; tests, bots, the
// tutorial and production each supply theirs, and the socket never knows about secrets or tickets.
export interface GameAuth {
  admit(ticket: string): JoinVerdict;
}

/**
 * Tickets signed with `secret`. A join with a ticket must carry a valid one;
 * a join with none is let in only when sign-in is not required (development,
 * bots, load tests).
 */
export function ticketAuth(secret: string, required: boolean, now?: () => number): GameAuth {
  const guard = new TicketGuard(secret, now);
  return {
    admit(ticket) {
      if (ticket === '') {
        return required ? { ok: false, reason: 'Sign in to play' } : { ok: true };
      }
      const result = guard.admit(ticket);
      if (result.ok)
        return {
          ok: true,
          identity: { playerId: result.claims.playerId, name: result.claims.name },
        };
      return {
        ok: false,
        reason:
          result.reason === 'expired' || result.reason === 'reused'
            ? 'Your sign-in ticket expired. Reload the page.'
            : 'Invalid sign-in ticket',
      };
    },
  };
}
