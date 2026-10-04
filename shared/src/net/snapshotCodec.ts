import { CodecError, type Reader } from './binary';
import type { EntityState, SelfState, SnapshotMessage } from './gameMessages';

/**
 * Compact snapshots for bandwidth (docs/api-protocol.md).
 *
 * Other players are sent as *changes* against what this client already has:
 * a stationary player costs nothing, a walking one a few bytes. This relies on
 * ordered, reliable delivery (WebSocket/TCP): the server and the client keep
 * identical baselines, so nothing needs acknowledging.
 *
 * Values are quantised on the wire (positions 2 cm in int16 → ±655 m, yaw 1.4°,
 * pitch 1.2°). Both sides keep the *quantised* numbers as the baseline, so
 * they can never drift apart.
 */

export const POSITION_UNIT = 0.02;
const POS_LIMIT = 32767;
const VELOCITY_UNIT = 0.001;

const enum Change {
  PosDelta = 1,
  PosAbs = 2,
  Yaw = 4,
  Pitch = 8,
  Flags = 16,
  Hp = 32,
}

interface Quantised {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  hp: number;
}

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

const qPos = (m: number): number =>
  Math.max(-POS_LIMIT - 1, Math.min(POS_LIMIT, Math.round(m / POSITION_UNIT)));
const qYaw = (rad: number): number => Math.round(((((rad % TAU) + TAU) % TAU) / TAU) * 256) & 255;
const qPitch = (rad: number): number =>
  Math.round((Math.max(-HALF_PI, Math.min(HALF_PI, rad)) / HALF_PI) * 127);

function toEntity(id: number, q: Quantised): EntityState {
  return {
    id,
    x: q.x * POSITION_UNIT,
    y: q.y * POSITION_UNIT,
    z: q.z * POSITION_UNIT,
    yaw: (q.yaw / 256) * TAU,
    pitch: (q.pitch / 127) * HALF_PI,
    flags: q.flags,
    hp: q.hp,
  };
}

/** Header: tick u32, ackSeq u16, self (f32×3 position, i16×3 velocity in mm/s, flags, hp, weapon, ammo), counts u8 ×2. */
const SELF_BYTES = 12 + 6 + 4;
const MAX_ENTITIES = 255;

const velocityToWire = (v: number): number =>
  Math.max(-32768, Math.min(32767, Math.round(v / VELOCITY_UNIT)));

/** Shared scratch space: a snapshot is written here, then copied out once at its exact size. */
const scratch = new Uint8Array(8192);
const scratchView = new DataView(scratch.buffer);

/**
 * One per client on the server. Remembers what that client has been told and
 * writes only what changed. Entities `removed` are forgotten (they left the
 * client's area of interest); the client drops them on the same message.
 *
 * This runs for every client every tick, so it allocates nothing but the
 * output bytes: values are compared as plain numbers, baselines are updated in
 * place, and the message is assembled in shared scratch memory.
 * Pattern: Object Pool (scratch buffer, in-place baselines) — Why: keeps the
 * garbage collector quiet during a 100-player tick.
 */
export class SnapshotEncoder {
  private readonly baseline = new Map<number, Quantised>();

  /** Entities with a record for the client right now (for tests and metrics). */
  get known(): number {
    return this.baseline.size;
  }

  /**
   * `entityCount` / `removedCount` let a caller reuse longer arrays and say how many
   * entries are live, instead of shrinking and regrowing them every tick.
   */
  encode(
    message: SnapshotMessage,
    writeType: number,
    entityCount = message.entities.length,
    removedCount = message.removed.length,
  ): Uint8Array {
    const { entities, removed } = message;
    if (entityCount > MAX_ENTITIES || removedCount > MAX_ENTITIES) {
      throw new CodecError('too many entities in one snapshot');
    }
    const v = scratchView;
    let o = 0;
    v.setUint8(o++, writeType);
    v.setUint32(o, message.tick, true);
    o += 4;
    v.setUint16(o, message.ackSeq, true);
    o += 2;
    const s = message.self;
    v.setFloat32(o, s.x, true);
    v.setFloat32(o + 4, s.y, true);
    v.setFloat32(o + 8, s.z, true);
    v.setInt16(o + 12, velocityToWire(s.vx), true);
    v.setInt16(o + 14, velocityToWire(s.vy), true);
    v.setInt16(o + 16, velocityToWire(s.vz), true);
    v.setUint8(o + 18, s.flags);
    v.setUint8(o + 19, s.hp);
    v.setUint8(o + 20, s.weapon);
    v.setUint8(o + 21, Math.min(255, s.ammo));
    o += SELF_BYTES;
    const countAt = o;
    o += 2; // entity and removed counts, filled in below
    let written = 0;

    for (let i = 0; i < entityCount; i++) {
      const e = entities[i] as EntityState;
      const qx = qPos(e.x);
      const qy = qPos(e.y);
      const qz = qPos(e.z);
      const qyaw = qYaw(e.yaw);
      const qpitch = qPitch(e.pitch);
      let base = this.baseline.get(e.id);
      let mask = 0;
      let dx = 0;
      let dy = 0;
      let dz = 0;
      if (!base) {
        mask = Change.PosAbs | Change.Yaw | Change.Pitch | Change.Flags | Change.Hp;
        base = { x: qx, y: qy, z: qz, yaw: qyaw, pitch: qpitch, flags: e.flags, hp: e.hp };
        this.baseline.set(e.id, base);
      } else {
        dx = qx - base.x;
        dy = qy - base.y;
        dz = qz - base.z;
        if (dx !== 0 || dy !== 0 || dz !== 0) {
          mask |=
            Math.abs(dx) <= 127 && Math.abs(dy) <= 127 && Math.abs(dz) <= 127
              ? Change.PosDelta
              : Change.PosAbs;
        }
        if (qyaw !== base.yaw) mask |= Change.Yaw;
        if (qpitch !== base.pitch) mask |= Change.Pitch;
        if (e.flags !== base.flags) mask |= Change.Flags;
        if (e.hp !== base.hp) mask |= Change.Hp;
      }
      if (mask === 0) continue; // nothing new for this client

      v.setUint16(o, e.id, true);
      v.setUint8(o + 2, mask);
      o += 3;
      if (mask & Change.PosDelta) {
        v.setInt8(o++, dx);
        v.setInt8(o++, dy);
        v.setInt8(o++, dz);
      }
      if (mask & Change.PosAbs) {
        v.setInt16(o, qx, true);
        v.setInt16(o + 2, qy, true);
        v.setInt16(o + 4, qz, true);
        o += 6;
      }
      if (mask & Change.Yaw) v.setUint8(o++, qyaw);
      if (mask & Change.Pitch) v.setInt8(o++, qpitch);
      if (mask & Change.Flags) v.setUint8(o++, e.flags);
      if (mask & Change.Hp) v.setUint8(o++, e.hp);
      base.x = qx;
      base.y = qy;
      base.z = qz;
      base.yaw = qyaw;
      base.pitch = qpitch;
      base.flags = e.flags;
      base.hp = e.hp;
      written++;
    }
    for (let i = 0; i < removedCount; i++) {
      const id = removed[i] as number;
      v.setUint16(o, id, true);
      o += 2;
      this.baseline.delete(id);
    }
    v.setUint8(countAt, written);
    v.setUint8(countAt + 1, removedCount);
    return scratch.slice(0, o);
  }
}

/** The client's mirror of {@link SnapshotEncoder}: rebuilds absolute states from changes. */
export class SnapshotDecoder {
  private readonly baseline = new Map<number, Quantised>();

  decode(r: Reader): SnapshotMessage {
    const tick = r.u32();
    const ackSeq = r.u16();
    const self: SelfState = {
      x: r.f32(),
      y: r.f32(),
      z: r.f32(),
      vx: r.i16() * VELOCITY_UNIT,
      vy: r.i16() * VELOCITY_UNIT,
      vz: r.i16() * VELOCITY_UNIT,
      flags: r.u8(),
      hp: r.u8(),
      weapon: r.u8(),
      ammo: r.u8(),
    };
    const count = r.u8();
    const removedCount = r.u8();
    const entities: EntityState[] = [];
    for (let i = 0; i < count; i++) {
      const id = r.u16();
      const mask = r.u8();
      let q = this.baseline.get(id);
      if (!q) {
        // A change against nothing is only valid as a full record.
        if (
          !(mask & Change.PosAbs) ||
          !(mask & Change.Yaw) ||
          !(mask & Change.Pitch) ||
          !(mask & Change.Flags) ||
          !(mask & Change.Hp)
        ) {
          throw new CodecError('entity update without a baseline');
        }
        q = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, hp: 0 };
        this.baseline.set(id, q);
      }
      if (mask & Change.PosDelta) {
        q.x += r.i8();
        q.y += r.i8();
        q.z += r.i8();
      }
      if (mask & Change.PosAbs) {
        q.x = r.i16();
        q.y = r.i16();
        q.z = r.i16();
      }
      if (mask & Change.Yaw) q.yaw = r.u8();
      if (mask & Change.Pitch) q.pitch = r.i8();
      if (mask & Change.Flags) q.flags = r.u8();
      if (mask & Change.Hp) q.hp = r.u8();
      entities.push(toEntity(id, q));
    }
    const removed: number[] = [];
    for (let i = 0; i < removedCount; i++) {
      const id = r.u16();
      removed.push(id);
      this.baseline.delete(id);
    }
    r.end();
    return { t: 'snapshot', tick, ackSeq, self, entities, removed };
  }
}
