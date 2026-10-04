import { jsonClientMessageSchema } from '@heist/shared';
import type { Player } from '../game/Player';
import { ElevatorHandler } from './ElevatorHandler';
import { InteractionService } from './InteractionService';
import type { MatchApi } from './MatchApi';

/**
 * The heist rules of a match, behind the JSON messages. The match calls in;
 * this object decides what each message means and answers through MatchApi.
 * Pattern: Facade — Why: Match stays about movement and shooting; vaults,
 * loot and tasks grow here without touching the tick loop.
 */
export class HeistController {
  readonly interactions: InteractionService;

  constructor(private readonly match: MatchApi) {
    this.interactions = new InteractionService(match).register('elevator', new ElevatorHandler());
  }

  /** One JSON text frame from a player. Malformed input is ignored: the sender is untrusted. */
  onJson(player: Player, text: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return;
    }
    const parsed = jsonClientMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.t === 'interact') {
      this.match.sendJson(player, {
        t: 'interact_result',
        ref: message.ref,
        anchor: message.anchor,
        result: this.interactions.use(player, message.anchor),
      });
    }
  }
}
