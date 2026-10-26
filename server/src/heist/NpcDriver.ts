import { Button, raycastMap, type InputCommand, type Rng } from '@heist/shared';
import type { Player } from '../game/Player';
import type { MatchApi } from './MatchApi';

/** Eye height for lines of sight, and the height of the chest an NPC aims at (m above the floor). */
export const EYE = 1.5;
export const CHEST = 1.2;
/** The vertical gap (m) beyond which an NPC cannot see a player: another floor. */
export const SAME_FLOOR = 2.5;

/** What a computer-driven player wants to do this tick. */
export interface NpcIntent {
  /** Where to walk, if anywhere. */
  readonly goal?: { readonly x: number; readonly z: number } | undefined;
  /** Walk at this share of a player's pace (0…1). */
  readonly speed: number;
  /** A point to look and shoot at, with the aim wandering by `aimErrorDegrees`. */
  readonly aim?: { readonly x: number; readonly y: number; readonly z: number } | undefined;
  readonly fire: boolean;
  readonly aimErrorDegrees: number;
  /** Sidestep this way (−1 left … 1 right) while moving, to get round what blocks the way. */
  readonly strafe?: number;
}

/** An NPC's running state: the next input number, and how long it has failed to move. */
export interface NpcState {
  seq: number;
  last: { x: number; z: number };
  stillTicks: number;
}

export const newNpcState = (at: { x: number; z: number }): NpcState => ({
  seq: 0,
  last: { x: at.x, z: at.z },
  stillTicks: 0,
});

/**
 * Sends a computer-driven player's moves the way a client would: input commands through the same
 * queue, so walls, spread, fire rate and damage are the real rules. Used by guards and police.
 */
export function driveNpc(
  match: MatchApi,
  npc: Player,
  state: NpcState,
  intent: NpcIntent,
  rng: Rng,
): { stuck: boolean } {
  const me = npc.body;
  const moving = intent.goal !== undefined;
  const face = intent.aim ?? intent.goal ?? { x: me.x, z: me.z };
  const dx = face.x - me.x;
  const dz = face.z - me.z;
  const horizontal = Math.hypot(dx, dz);
  const wander = (intent.aimErrorDegrees * Math.PI) / 180;
  const yaw =
    horizontal > 0.01
      ? Math.atan2(-dx, -dz) + (intent.aim ? (rng.next() * 2 - 1) * wander : 0)
      : npc.yaw;
  const pitch = intent.aim ? Math.atan2(intent.aim.y - (me.y + EYE), Math.max(0.1, horizontal)) : 0;

  const moved = Math.hypot(me.x - state.last.x, me.z - state.last.z);
  state.last = { x: me.x, z: me.z };
  state.stillTicks = moving && moved < 0.02 ? state.stillTicks + 1 : 0;

  const commands: InputCommand[] = [];
  const n = Math.max(1, Math.round(60 / match.tickRate));
  for (let i = 0; i < n; i++)
    commands.push({
      seq: (state.seq = (state.seq + 1) & 0xffff),
      moveX: moving && intent.strafe ? Math.round(127 * intent.speed * intent.strafe) : 0,
      moveY: moving ? Math.round(127 * intent.speed) : 0,
      yaw,
      pitch,
      buttons: intent.fire ? Button.Fire : 0,
      viewLagMs: 0,
    });
  match.drive(npc, commands);
  return { stuck: state.stillTicks > 25 };
}

/** The nearest living person the NPC can see: close enough, on its floor, with nothing in the way. */
export function nearestVisible(
  match: MatchApi,
  npc: Player,
  people: readonly Player[],
  range: number,
): Player | undefined {
  const me = npc.body;
  let best: Player | undefined;
  let bestD = Infinity;
  for (const p of people) {
    if (Math.abs(p.body.y - me.y) > SAME_FLOOR) continue;
    const dx = p.body.x - me.x;
    const dz = p.body.z - me.z;
    const dy = p.body.y + CHEST - (me.y + EYE);
    const d = Math.hypot(dx, dz);
    if (d > range || d >= bestD) continue;
    const len = Math.hypot(dx, dy, dz) || 1;
    const wall = raycastMap(match.map, me.x, me.y + EYE, me.z, dx / len, dy / len, dz / len, len);
    if (wall !== undefined && wall < len - 0.3) continue;
    best = p;
    bestD = d;
  }
  return best;
}
