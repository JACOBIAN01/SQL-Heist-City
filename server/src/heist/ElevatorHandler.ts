import type { InteractResult, MapAnchor } from '@heist/shared';
import type { Player } from '../game/Player';
import type { InteractionHandler } from './InteractionService';
import type { MatchApi } from './MatchApi';

/** Rides to the next storey up in the same bank; from the top it goes back to the ground. */
export class ElevatorHandler implements InteractionHandler {
  use(player: Player, anchor: MapAnchor, match: MatchApi): InteractResult {
    const lifts = (match.map.anchors ?? [])
      .filter((a) => a.kind === 'elevator' && a.bank === anchor.bank)
      .sort((a, b) => a.storey - b.storey);
    const next = lifts.find((a) => a.storey > anchor.storey) ?? lifts[0];
    if (!next || next === anchor) return { action: 'denied', reason: 'not_available' };
    match.teleport(player, next.x, next.y, next.z);
    return { action: 'moved', storey: next.storey };
  }
}
