import type { VehicleKind } from '../config/vehicles';
import type { InputCommand } from '../sim/input';

/**
 * High-rate game messages (binary frames). Challenge messages stay JSON text
 * frames on the same kind of socket; see challengeMessages.ts.
 */

export const MAX_NAME_LENGTH = 24;
/** Most commands one INPUT message may carry. */
export const MAX_COMMANDS_PER_MESSAGE = 8;

// --- client → server ---------------------------------------------------------

export interface JoinMessage {
  readonly t: 'join';
  readonly protocol: number;
  readonly name: string;
}

export interface InputMessage {
  readonly t: 'input';
  readonly commands: readonly InputCommand[];
}

export interface PingMessage {
  readonly t: 'ping';
  /** Client clock, echoed back unchanged to measure round-trip time. */
  readonly clientTime: number;
}

/**
 * Low-rate messages (SQL tasks, interactions, inventory) travel as JSON text
 * inside a binary frame: the hot path stays compact and the rest stays
 * readable. The payload is validated by its own zod schema on arrival.
 */
export interface JsonMessage {
  readonly t: 'json';
  readonly text: string;
}

/** Largest JSON payload either side accepts: a 5 000-character query still fits in UTF-8. */
export const MAX_JSON_BYTES = 24 * 1024;

export type ClientMessage = JoinMessage | InputMessage | PingMessage | JsonMessage;

// --- server → client ---------------------------------------------------------

export interface WelcomeMessage {
  readonly t: 'welcome';
  readonly playerId: number;
  readonly tick: number;
  readonly tickRate: number;
  readonly mapId: string;
}

/** State flags packed in one byte. */
export const Flag = {
  Crouching: 1,
  OnGround: 2,
  Alive: 4,
  /** Spawn protection: cannot be hurt. */
  Protected: 16,
  /** Carrying cash: others see a bag on the back. */
  Carrying: 32,
} as const;

/** Spare flag bits that carry which gun a player holds (0 = none, 1–5 = WEAPON_IDS order) so others can draw it. */
const WEAPON_BITS = [8, 64, 128] as const;

export function flagsWithWeapon(flags: number, weaponWire: number): number {
  let out = flags;
  WEAPON_BITS.forEach((bit, i) => {
    if ((weaponWire >> i) & 1) out |= bit;
  });
  return out;
}

export function weaponOfFlags(flags: number): number {
  let wire = 0;
  WEAPON_BITS.forEach((bit, i) => {
    if (flags & bit) wire |= 1 << i;
  });
  return wire;
}

/** The receiving player's own full state: enough to rewind and replay prediction. */
export interface SelfState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly flags: number;
  readonly hp: number;
  /** Weapon held: 0 = none, else 1 + its index in WEAPON_IDS. */
  readonly weapon: number;
  /** Rounds left in the magazine. */
  readonly ammo: number;
  /** The vehicle this player is driving, 0 when on foot. */
  readonly vehicle: number;
}

export interface EntityState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly flags: number;
  readonly hp: number;
}

/**
 * A car as the client sees it. Sent in full whenever anything about it
 * changed (cars are few; a parked one costs nothing after the first time).
 */
export interface VehicleWire {
  readonly id: number;
  readonly kind: VehicleKind;
  /** Which look within the kind (the client maps it to a model). */
  readonly variant: number;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /** Front-wheel angle, rad. */
  readonly steer: number;
  /** m/s along the car's forward. */
  readonly speed: number;
  /** Player driving it, 0 when empty. */
  readonly driver: number;
}

export interface SnapshotMessage {
  readonly t: 'snapshot';
  readonly tick: number;
  /** Last of *your* input sequence numbers the server has applied. */
  readonly ackSeq: number;
  readonly self: SelfState;
  /**
   * Other players whose state changed since the last snapshot *this client* got
   * (area of interest + change detection decide who is listed). Anyone not
   * listed and not removed is unchanged.
   */
  readonly entities: readonly EntityState[];
  /** Players that left this client's area of interest: forget them. */
  readonly removed: readonly number[];
  /** Cars that changed since this client's last snapshot (or came into range). */
  readonly vehicles: readonly VehicleWire[];
  /** Cars that left this client's area of interest. */
  readonly vehiclesRemoved: readonly number[];
}

export type HitKind = 'miss' | 'body' | 'head';

export interface ShotEvent {
  readonly e: 'shot';
  readonly shooter: number;
  /** Where the bullet ended (target, wall or max range): the tracer is drawn to here. */
  readonly endX: number;
  readonly endY: number;
  readonly endZ: number;
  readonly hit: HitKind;
  /** Player id hit, or 0 when nothing was. */
  readonly target: number;
}

export interface KillEvent {
  readonly e: 'kill';
  readonly killer: number;
  readonly victim: number;
}

export interface PlayerJoinedEvent {
  readonly e: 'joined';
  readonly id: number;
  readonly name: string;
}

export interface PlayerLeftEvent {
  readonly e: 'left';
  readonly id: number;
}

export type GameEvent = ShotEvent | KillEvent | PlayerJoinedEvent | PlayerLeftEvent;

export interface EventMessage {
  readonly t: 'event';
  readonly event: GameEvent;
}

export interface PongMessage {
  readonly t: 'pong';
  readonly clientTime: number;
  readonly tick: number;
}

export type ServerMessage =
  WelcomeMessage | SnapshotMessage | EventMessage | PongMessage | JsonMessage;
