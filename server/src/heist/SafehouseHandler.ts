import type { InteractResult, MapAnchor } from '@heist/shared';
import type { Player } from '../game/Player';
import type { BankingService } from './BankingService';
import type { InteractionHandler } from './InteractionService';
import type { MatchApi } from './MatchApi';

/** F at a safehouse starts banking, if there is anything to bank. */
export class SafehouseHandler implements InteractionHandler {
  constructor(private readonly banking: BankingService) {}

  use(player: Player, anchor: MapAnchor, _match: MatchApi): InteractResult {
    if (player.cash <= 0) return { action: 'denied', reason: 'nothing_to_bank' };
    if (this.banking.isBanking(player)) return { action: 'denied', reason: 'cooldown' };
    return { action: 'banking', seconds: this.banking.start(player, anchor) };
  }
}
