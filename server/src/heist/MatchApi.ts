import type { GameMap, JsonServerMessage, WeaponSpec } from '@heist/shared';
import type { Player } from '../game/Player';

/**
 * What the heist rules may do to a match. A narrow interface (SOLID: I + D —
 * Why: the rules are tested against a small fake instead of a whole Match,
 * and they cannot reach into tick internals).
 */
export interface MatchApi {
  readonly tick: number;
  readonly tickRate: number;
  readonly maxHp: number;
  /** Heist maps start everyone unarmed. */
  readonly unarmedStart: boolean;
  weaponSpec(id: string): WeaponSpec | undefined;
  readonly map: GameMap;
  getPlayer(id: number): Player | undefined;
  playerList(): Iterable<Player>;
  /** Players within `radius` metres of a point on the ground plane (alive or not). */
  playersNear(x: number, z: number, radius: number): Player[];
  /** One JSON message to one player. */
  sendJson(player: Player, message: JsonServerMessage): void;
  /** Same message to every player. */
  broadcastJson(message: JsonServerMessage): void;
  /** The map movement and shots collide with right now (vault doors open and close). */
  setCollisionMap(map: GameMap): void;
  /** A new round: every player back to full health, empty-handed, alive, at a street spawn, with a clean score. */
  resetPlayersForRound(): void;
  /** Moves a player instantly (elevators); their velocity is cleared. */
  teleport(player: Player, x: number, y: number, z: number): void;
}
