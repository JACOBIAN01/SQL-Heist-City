import type { ClassMatchConfig } from '../classes/ClassMatchConfig';
import type {
  GameMap,
  JsonServerMessage,
  VehicleMessage,
  VehicleReply,
  WeaponSpec,
} from '@heist/shared';
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
  /** Every gun's numbers (sent to each client on join). */
  readonly weapons: Readonly<Record<string, WeaponSpec>>;
  /** Re-reads combat settings the admin changed and tells every client (between rounds). */
  refreshCombat(): void;
  /** Re-reads heist, car and time-of-day settings the admin changed and tells every client (between rounds). */
  refreshWorld(): void;
  /** Sends one player the car and time-of-day numbers (on join). */
  sendWorld(player: Player): void;
  readonly map: GameMap;
  /** The class this match serves, if it is a class room. */
  readonly classInfo: ClassMatchConfig | undefined;
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
  /** Get into or out of a car; the match checks range, speed and room to step out. */
  vehicleRequest(player: Player, message: VehicleMessage): VehicleReply;
}
