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

export type ClientMessage = JoinMessage | InputMessage | PingMessage;

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
  Firing: 8,
  /** Spawn protection: cannot be hurt. */
  Protected: 16,
} as const;

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

export interface SnapshotMessage {
  readonly t: 'snapshot';
  readonly tick: number;
  /** Last of *your* input sequence numbers the server has applied. */
  readonly ackSeq: number;
  readonly self: SelfState;
  /** Everyone else (Phase 6 filters this by area of interest). */
  readonly entities: readonly EntityState[];
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

export type ServerMessage = WelcomeMessage | SnapshotMessage | EventMessage | PongMessage;
