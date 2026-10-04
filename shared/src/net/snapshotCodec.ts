import type { Reader } from './binary';
import { CodecError, Writer } from './binary';
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

function quantise(e: EntityState): Quantised {
  return {
    x: qPos(e.x),
    y: qPos(e.y),
    z: qPos(e.z),
    yaw: qYaw(e.yaw),
    pitch: qPitch(e.pitch),
    flags: e.flags,
    hp: e.hp,
  };
}

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

/** Header: tick u32, ackSeq u16, self (f32×3 position, i16×3 velocity in mm/s, flags, hp), counts u8 ×2. */
const SELF_BYTES = 12 + 6 + 2;
const MAX_ENTITIES = 255;

const velocityToWire = (v: number): number =>
  Math.max(-32768, Math.min(32767, Math.round(v / VELOCITY_UNIT)));

/**
 * One per client on the server. Remembers what that client has been told and
 * writes only what changed. Entities `removed` are forgotten (they left the
 * client's area of interest); the client drops them on the same message.
 */
export class SnapshotEncoder {
  private readonly baseline = new Map<number, Quantised>();

  /** Entities with a record for the client right now (for tests and metrics). */
  get known(): number {
    return this.baseline.size;
  }

  encode(message: SnapshotMessage, writeType: number): Uint8Array {
    if (message.entities.length > MAX_ENTITIES || message.removed.length > MAX_ENTITIES) {
      throw new CodecError('too many entities in one snapshot');
    }
    // Decide each entity's record first (needs to know sizes before writing).
    const records: { id: number; mask: number; q: Quantised; base: Quantised | undefined }[] = [];
    let size = 1 + 4 + 2 + SELF_BYTES + 2;
    for (const e of message.entities) {
      const q = quantise(e);
      const base = this.baseline.get(e.id);
      let mask = 0;
      if (!base) {
        mask = Change.PosAbs | Change.Yaw | Change.Pitch | Change.Flags | Change.Hp;
      } else {
        const dx = q.x - base.x;
        const dy = q.y - base.y;
        const dz = q.z - base.z;
        if (dx !== 0 || dy !== 0 || dz !== 0) {
          mask |=
            Math.abs(dx) <= 127 && Math.abs(dy) <= 127 && Math.abs(dz) <= 127
              ? Change.PosDelta
              : Change.PosAbs;
        }
        if (q.yaw !== base.yaw) mask |= Change.Yaw;
        if (q.pitch !== base.pitch) mask |= Change.Pitch;
        if (q.flags !== base.flags) mask |= Change.Flags;
        if (q.hp !== base.hp) mask |= Change.Hp;
      }
      if (mask === 0) continue; // nothing new for this client
      records.push({ id: e.id, mask, q, base });
      size += 3;
      if (mask & Change.PosDelta) size += 3;
      if (mask & Change.PosAbs) size += 6;
      if (mask & Change.Yaw) size += 1;
      if (mask & Change.Pitch) size += 1;
      if (mask & Change.Flags) size += 1;
      if (mask & Change.Hp) size += 1;
    }
    size += message.removed.length * 2;

    const s: SelfState = message.self;
    const w = new Writer(size)
      .u8(writeType)
      .u32(message.tick)
      .u16(message.ackSeq)
      .f32(s.x)
      .f32(s.y)
      .f32(s.z)
      .i16(velocityToWire(s.vx))
      .i16(velocityToWire(s.vy))
      .i16(velocityToWire(s.vz))
      .u8(s.flags)
      .u8(s.hp)
      .u8(records.length)
      .u8(message.removed.length);
    for (const r of records) {
      w.u16(r.id).u8(r.mask);
      if (r.mask & Change.PosDelta && r.base) {
        w.i8(r.q.x - r.base.x)
          .i8(r.q.y - r.base.y)
          .i8(r.q.z - r.base.z);
      }
      if (r.mask & Change.PosAbs) w.i16(r.q.x).i16(r.q.y).i16(r.q.z);
      if (r.mask & Change.Yaw) w.u8(r.q.yaw);
      if (r.mask & Change.Pitch) w.i8(r.q.pitch);
      if (r.mask & Change.Flags) w.u8(r.q.flags);
      if (r.mask & Change.Hp) w.u8(r.q.hp);
      this.baseline.set(r.id, r.q);
    }
    for (const id of message.removed) {
      w.u16(id);
      this.baseline.delete(id);
    }
    return w.bytes;
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
