import type { GameMap, JsonServerMessage } from '@heist/shared';
import type { Player } from '../game/Player';

/**
 * What the heist rules may do to a match. A narrow interface (SOLID: I + D —
 * Why: the rules are tested against a small fake instead of a whole Match,
 * and they cannot reach into tick internals).
 */
export interface MatchApi {
  readonly tick: number;
  readonly tickRate: number;
  readonly map: GameMap;
  getPlayer(id: number): Player | undefined;
  playerList(): Iterable<Player>;
  /** One JSON message to one player. */
  sendJson(player: Player, message: JsonServerMessage): void;
  /** Moves a player instantly (elevators); their velocity is cleared. */
  teleport(player: Player, x: number, y: number, z: number): void;
}
