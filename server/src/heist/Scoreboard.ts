import type { StandingView } from '@heist/shared';
import type { Player } from '../game/Player';

/**
 * Banked cash decides the round; kills break ties, then the earlier join.
 * Target dummies are not players and never appear.
 */
export function rankPlayers(players: Iterable<Player>): Player[] {
  return [...players]
    .filter((p) => !p.isDummy)
    .sort((a, b) => b.banked - a.banked || b.kills - a.kills || a.id - b.id);
}

export const toStanding = (p: Player): StandingView => ({
  id: p.id,
  name: p.name,
  banked: p.banked,
  kills: p.kills,
});
