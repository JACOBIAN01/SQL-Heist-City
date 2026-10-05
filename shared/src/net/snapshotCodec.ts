import { CodecError, type Reader } from './binary';
import { VEHICLE_KINDS } from '../config/vehicles';
import type { EntityState, SelfState, SnapshotMessage, VehicleWire } from './gameMessages';

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

/** Header: tick u32, ackSeq u16, self (f32×3 position, i16×3 velocity in mm/s, flags, hp, weapon, ammo, vehicle u16), counts u8 ×2. */
const SELF_BYTES = 12 + 6 + 4 + 2;

/** Car on the wire: id u16, look u8 (kind × 16 + variant), x z i16, yaw u16, steer i8, speed i16, driver u16. */
const VEHICLE_BYTES = 14;
const STEER_UNIT = 0.01;
const SPEED_UNIT = 0.01;
const MAX_VARIANT = 15;

interface QuantisedVehicle {
  look: number;
  x: number;
  z: number;
  yaw: number;
  steer: number;
  speed: number;
  driver: number;
}

const qYaw16 = (rad: number): number =>
  Math.round(((((rad % TAU) + TAU) % TAU) / TAU) * 65536) & 0xffff;
const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

function quantiseVehicle(v: VehicleWire, out: QuantisedVehicle): QuantisedVehicle {
  out.look = VEHICLE_KINDS.indexOf(v.kind) * 16 + Math.min(MAX_VARIANT, v.variant);
  out.x = qPos(v.x);
  out.z = qPos(v.z);
  out.yaw = qYaw16(v.yaw);
  out.steer = clampInt(v.steer / STEER_UNIT, -127, 127);
  out.speed = clampInt(v.speed / SPEED_UNIT, -32768, 32767);
  out.driver = v.driver;
  return out;
}

function vehicleOf(id: number, q: QuantisedVehicle): VehicleWire {
  const kind = VEHICLE_KINDS[q.look >> 4];
  if (!kind) throw new CodecError('unknown vehicle kind');
  return {
    id,
    kind,
    variant: q.look & 15,
    x: q.x * POSITION_UNIT,
    z: q.z * POSITION_UNIT,
    yaw: (q.yaw / 65536) * TAU,
    steer: q.steer * STEER_UNIT,
    speed: q.speed * SPEED_UNIT,
    driver: q.driver,
  };
}

const sameVehicle = (a: QuantisedVehicle, b: QuantisedVehicle) =>
  a.look === b.look &&
  a.x === b.x &&
  a.z === b.z &&
  a.yaw === b.yaw &&
  a.steer === b.steer &&
  a.speed === b.speed &&
  a.driver === b.driver;

/**
 * The car a driver predicts must arrive exactly as the server holds it, so
 * the server simulates on these same quantised values (see quantiseVehicleState).
 */
export function quantiseVehicleState(state: {
  x: number;
  z: number;
  yaw: number;
  steer: number;
  speed: number;
}): void {
  state.x = qPos(state.x) * POSITION_UNIT;
  state.z = qPos(state.z) * POSITION_UNIT;
  state.yaw = (qYaw16(state.yaw) / 65536) * TAU;
  state.steer = clampInt(state.steer / STEER_UNIT, -127, 127) * STEER_UNIT;
  state.speed = clampInt(state.speed / SPEED_UNIT, -32768, 32767) * SPEED_UNIT;
}
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
  private readonly vehicleBaseline = new Map<number, QuantisedVehicle>();
  private readonly vehicleScratch: QuantisedVehicle = {
    look: 0,
    x: 0,
    z: 0,
    yaw: 0,
    steer: 0,
    speed: 0,
    driver: 0,
  };

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
    vehicleCount = message.vehicles.length,
    vehicleRemovedCount = message.vehiclesRemoved.length,
  ): Uint8Array {
    const { entities, removed } = message;
    if (
      entityCount > MAX_ENTITIES ||
      removedCount > MAX_ENTITIES ||
      vehicleCount > MAX_ENTITIES ||
      vehicleRemovedCount > MAX_ENTITIES
    ) {
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
    v.setUint16(o + 22, s.vehicle, true);
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

    // Cars: sent in full when anything about them changed for this client.
    const carCountAt = o;
    o += 2;
    let carsWritten = 0;
    for (let i = 0; i < vehicleCount; i++) {
      const car = message.vehicles[i] as VehicleWire;
      const q = quantiseVehicle(car, this.vehicleScratch);
      const base = this.vehicleBaseline.get(car.id);
      if (base && sameVehicle(base, q)) continue;
      if (base) Object.assign(base, q);
      else this.vehicleBaseline.set(car.id, { ...q });
      v.setUint16(o, car.id, true);
      v.setUint8(o + 2, q.look);
      v.setInt16(o + 3, q.x, true);
      v.setInt16(o + 5, q.z, true);
      v.setUint16(o + 7, q.yaw, true);
      v.setInt8(o + 9, q.steer);
      v.setInt16(o + 10, q.speed, true);
      v.setUint16(o + 12, q.driver, true);
      o += VEHICLE_BYTES;
      carsWritten++;
    }
    for (let i = 0; i < vehicleRemovedCount; i++) {
      const id = message.vehiclesRemoved[i] as number;
      v.setUint16(o, id, true);
      o += 2;
      this.vehicleBaseline.delete(id);
    }
    v.setUint8(carCountAt, carsWritten);
    v.setUint8(carCountAt + 1, vehicleRemovedCount);
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
      vehicle: r.u16(),
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
    const carCount = r.u8();
    const carRemovedCount = r.u8();
    const vehicles: VehicleWire[] = [];
    for (let i = 0; i < carCount; i++) {
      const id = r.u16();
      const q: QuantisedVehicle = {
        look: r.u8(),
        x: r.i16(),
        z: r.i16(),
        yaw: r.u16(),
        steer: r.i8(),
        speed: r.i16(),
        driver: r.u16(),
      };
      vehicles.push(vehicleOf(id, q));
    }
    const vehiclesRemoved: number[] = [];
    for (let i = 0; i < carRemovedCount; i++) vehiclesRemoved.push(r.u16());
    r.end();
    return { t: 'snapshot', tick, ackSeq, self, entities, removed, vehicles, vehiclesRemoved };
  }
}
