import {
  anchorInReach,
  findAnchor,
  type AnchorKind,
  type InteractResult,
  type MapAnchor,
} from '@heist/shared';
import type { Player } from '../game/Player';
import type { MatchApi } from './MatchApi';

/** Slack on the reach check: the player's screen is a little behind the server's body. */
export const REACH_SLACK = 0.75;
/** Minimum seconds between two uses by one player. */
export const INTERACT_COOLDOWN_SEC = 0.75;

/** One kind of anchor and what pressing F there does. */
export interface InteractionHandler {
  use(player: Player, anchor: MapAnchor, match: MatchApi): InteractResult;
}

// Pattern: Strategy (registry by anchor kind) — Why: each kind of usable spot
// (lift, vault console, safehouse…) has its own rules, and adding one is a new
// handler registered here, with no change to the validation every use shares.
export class InteractionService {
  private readonly handlers = new Map<AnchorKind, InteractionHandler>();

  constructor(private readonly match: MatchApi) {}

  register(kind: AnchorKind, handler: InteractionHandler): this {
    this.handlers.set(kind, handler);
    return this;
  }

  /** Validates a use (exists, alive, close enough, not spammed) and hands it to the kind's handler. */
  use(player: Player, anchorId: string): InteractResult {
    const anchor = findAnchor(this.match.map, anchorId);
    if (!anchor) return { action: 'denied', reason: 'unknown_anchor' };
    if (!player.alive) return { action: 'denied', reason: 'dead' };
    const { x, y, z } = player.body;
    // Reach is measured with a little slack; the client prompts at the exact radius.
    if (!anchorInReach({ ...anchor, radius: anchor.radius + REACH_SLACK }, x, y, z))
      return { action: 'denied', reason: 'too_far' };
    if (this.match.tick < player.interactReadyTick) return { action: 'denied', reason: 'cooldown' };
    const handler = this.handlers.get(anchor.kind);
    if (!handler) return { action: 'denied', reason: 'not_available' };
    player.interactReadyTick =
      this.match.tick + Math.ceil(INTERACT_COOLDOWN_SEC * this.match.tickRate);
    return handler.use(player, anchor, this.match);
  }
}
