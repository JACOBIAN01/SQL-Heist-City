import {
  LAG_STEP_MS,
  pitchFromWire,
  pitchToWire,
  quantiseLag,
  yawFromWire,
  yawToWire,
  type InputCommand,
} from '../sim/input';
import {
  MAX_COMMANDS_PER_MESSAGE,
  MAX_NAME_LENGTH,
  type ClientMessage,
  type EntityState,
  type GameEvent,
  type HitKind,
  type ServerMessage,
} from './gameMessages';

/** Thrown for malformed or hostile frames. The server drops the message (or client), never crashes. */
export class CodecError extends Error {
  override readonly name = 'CodecError';
}

const enum ClientType {
  Join = 0x01,
  Input = 0x02,
  Ping = 0x03,
}
const enum ServerType {
  Welcome = 0x81,
  Snapshot = 0x82,
  Event = 0x83,
  Pong = 0x84,
}
const enum EventType {
  Shot = 1,
  Kill = 2,
  Joined = 3,
  Left = 4,
}

const HIT_CODES: readonly HitKind[] = ['miss', 'body', 'head'];
const COMMAND_BYTES = 10;
const ENTITY_BYTES = 2 + 12 + 2 + 2 + 1 + 1;
const SELF_BYTES = 24 + 2;
const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

/** Sequential little-endian reader that throws CodecError instead of reading past the end. */
class Reader {
  private offset = 0;
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.view.byteLength - this.offset;
  }

  private take(size: number): number {
    if (this.remaining < size) throw new CodecError('message truncated');
    const at = this.offset;
    this.offset += size;
    return at;
  }

  u8(): number {
    return this.view.getUint8(this.take(1));
  }
  i8(): number {
    return this.view.getInt8(this.take(1));
  }
  u16(): number {
    return this.view.getUint16(this.take(2), true);
  }
  i16(): number {
    return this.view.getInt16(this.take(2), true);
  }
  u32(): number {
    return this.view.getUint32(this.take(4), true);
  }
  f32(): number {
    const value = this.view.getFloat32(this.take(4), true);
    if (!Number.isFinite(value)) throw new CodecError('non-finite number');
    return value;
  }
  f64(): number {
    const value = this.view.getFloat64(this.take(8), true);
    if (!Number.isFinite(value)) throw new CodecError('non-finite number');
    return value;
  }
  string(maxLength: number): string {
    const length = this.u8();
    if (length > maxLength) throw new CodecError('string too long');
    const at = this.take(length);
    try {
      return utf8Decoder.decode(
        new Uint8Array(this.view.buffer, this.view.byteOffset + at, length),
      );
    } catch {
      throw new CodecError('invalid utf-8');
    }
  }
  end(): void {
    if (this.remaining !== 0) throw new CodecError('trailing bytes');
  }
}

/** Sequential little-endian writer over a pre-sized buffer. */
class Writer {
  private offset = 0;
  private readonly view: DataView;
  readonly bytes: Uint8Array;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  u8(v: number): this {
    this.view.setUint8(this.offset++, v);
    return this;
  }
  i8(v: number): this {
    this.view.setInt8(this.offset++, v);
    return this;
  }
  u16(v: number): this {
    this.view.setUint16(this.offset, v, true);
    this.offset += 2;
    return this;
  }
  i16(v: number): this {
    this.view.setInt16(this.offset, v, true);
    this.offset += 2;
    return this;
  }
  u32(v: number): this {
    this.view.setUint32(this.offset, v, true);
    this.offset += 4;
    return this;
  }
  f32(v: number): this {
    this.view.setFloat32(this.offset, v, true);
    this.offset += 4;
    return this;
  }
  f64(v: number): this {
    this.view.setFloat64(this.offset, v, true);
    this.offset += 8;
    return this;
  }
  string(text: string): this {
    const encoded = utf8.encode(text);
    this.u8(encoded.length);
    this.bytes.set(encoded, this.offset);
    this.offset += encoded.length;
    return this;
  }
}

const stringBytes = (text: string): number => 1 + utf8.encode(text).length;

// --- client messages ---------------------------------------------------------

export function encodeClientMessage(message: ClientMessage): Uint8Array {
  switch (message.t) {
    case 'join': {
      if (utf8.encode(message.name).length > MAX_NAME_LENGTH) {
        throw new CodecError('name too long');
      }
      return new Writer(2 + stringBytes(message.name))
        .u8(ClientType.Join)
        .u8(message.protocol)
        .string(message.name).bytes;
    }
    case 'input': {
      const count = message.commands.length;
      if (count === 0 || count > MAX_COMMANDS_PER_MESSAGE) {
        throw new CodecError('bad command count');
      }
      const w = new Writer(2 + count * COMMAND_BYTES).u8(ClientType.Input).u8(count);
      for (const c of message.commands) {
        w.u16(c.seq)
          .i8(c.moveX)
          .i8(c.moveY)
          .u16(yawToWire(c.yaw))
          .i16(pitchToWire(c.pitch))
          .u8(c.buttons)
          .u8(Math.round(quantiseLag(c.viewLagMs) / LAG_STEP_MS));
      }
      return w.bytes;
    }
    case 'ping':
      return new Writer(9).u8(ClientType.Ping).f64(message.clientTime).bytes;
  }
}

export function decodeClientMessage(bytes: Uint8Array): ClientMessage {
  const r = new Reader(bytes);
  const type = r.u8();
  switch (type) {
    case ClientType.Join: {
      const protocol = r.u8();
      const name = r.string(MAX_NAME_LENGTH);
      r.end();
      return { t: 'join', protocol, name };
    }
    case ClientType.Input: {
      const count = r.u8();
      if (count === 0 || count > MAX_COMMANDS_PER_MESSAGE)
        throw new CodecError('bad command count');
      const commands: InputCommand[] = [];
      for (let i = 0; i < count; i++) {
        const seq = r.u16();
        const moveX = r.i8();
        const moveY = r.i8();
        // −128 is not a valid stick value; clamping stops it counting as stronger than full tilt.
        commands.push({
          seq,
          moveX: Math.max(-127, moveX),
          moveY: Math.max(-127, moveY),
          yaw: yawFromWire(r.u16()),
          pitch: pitchFromWire(r.i16()),
          buttons: r.u8(),
          viewLagMs: r.u8() * LAG_STEP_MS,
        });
      }
      r.end();
      return { t: 'input', commands };
    }
    case ClientType.Ping: {
      const clientTime = r.f64();
      r.end();
      return { t: 'ping', clientTime };
    }
    default:
      throw new CodecError(`unknown client message type ${type}`);
  }
}

// --- server messages ---------------------------------------------------------

function eventBytes(event: GameEvent): number {
  switch (event.e) {
    case 'shot':
      return 1 + 2 + 12 + 1 + 2;
    case 'kill':
      return 1 + 4;
    case 'joined':
      return 1 + 2 + stringBytes(event.name);
    case 'left':
      return 1 + 2;
  }
}

export function encodeServerMessage(message: ServerMessage): Uint8Array {
  switch (message.t) {
    case 'welcome':
      return new Writer(1 + 2 + 4 + 1 + stringBytes(message.mapId))
        .u8(ServerType.Welcome)
        .u16(message.playerId)
        .u32(message.tick)
        .u8(message.tickRate)
        .string(message.mapId).bytes;
    case 'snapshot': {
      const s = message.self;
      const w = new Writer(1 + 4 + 2 + SELF_BYTES + 2 + message.entities.length * ENTITY_BYTES)
        .u8(ServerType.Snapshot)
        .u32(message.tick)
        .u16(message.ackSeq)
        .f32(s.x)
        .f32(s.y)
        .f32(s.z)
        .f32(s.vx)
        .f32(s.vy)
        .f32(s.vz)
        .u8(s.flags)
        .u8(s.hp)
        .u16(message.entities.length);
      for (const e of message.entities) {
        w.u16(e.id)
          .f32(e.x)
          .f32(e.y)
          .f32(e.z)
          .u16(yawToWire(e.yaw))
          .i16(pitchToWire(e.pitch))
          .u8(e.flags)
          .u8(e.hp);
      }
      return w.bytes;
    }
    case 'event': {
      const ev = message.event;
      const w = new Writer(1 + eventBytes(ev)).u8(ServerType.Event);
      switch (ev.e) {
        case 'shot':
          w.u8(EventType.Shot)
            .u16(ev.shooter)
            .f32(ev.endX)
            .f32(ev.endY)
            .f32(ev.endZ)
            .u8(HIT_CODES.indexOf(ev.hit))
            .u16(ev.target);
          break;
        case 'kill':
          w.u8(EventType.Kill).u16(ev.killer).u16(ev.victim);
          break;
        case 'joined':
          w.u8(EventType.Joined).u16(ev.id).string(ev.name);
          break;
        case 'left':
          w.u8(EventType.Left).u16(ev.id);
          break;
      }
      return w.bytes;
    }
    case 'pong':
      return new Writer(13).u8(ServerType.Pong).f64(message.clientTime).u32(message.tick).bytes;
  }
}

export function decodeServerMessage(bytes: Uint8Array): ServerMessage {
  const r = new Reader(bytes);
  const type = r.u8();
  switch (type) {
    case ServerType.Welcome: {
      const playerId = r.u16();
      const tick = r.u32();
      const tickRate = r.u8();
      const mapId = r.string(64);
      r.end();
      return { t: 'welcome', playerId, tick, tickRate, mapId };
    }
    case ServerType.Snapshot: {
      const tick = r.u32();
      const ackSeq = r.u16();
      const self = {
        x: r.f32(),
        y: r.f32(),
        z: r.f32(),
        vx: r.f32(),
        vy: r.f32(),
        vz: r.f32(),
        flags: r.u8(),
        hp: r.u8(),
      };
      const count = r.u16();
      if (count * ENTITY_BYTES > r.remaining) throw new CodecError('entity count exceeds message');
      const entities: EntityState[] = [];
      for (let i = 0; i < count; i++) {
        entities.push({
          id: r.u16(),
          x: r.f32(),
          y: r.f32(),
          z: r.f32(),
          yaw: yawFromWire(r.u16()),
          pitch: pitchFromWire(r.i16()),
          flags: r.u8(),
          hp: r.u8(),
        });
      }
      r.end();
      return { t: 'snapshot', tick, ackSeq, self, entities };
    }
    case ServerType.Event: {
      const kind = r.u8();
      let event: GameEvent;
      switch (kind) {
        case EventType.Shot: {
          const shooter = r.u16();
          const endX = r.f32();
          const endY = r.f32();
          const endZ = r.f32();
          const hit = HIT_CODES[r.u8()];
          if (hit === undefined) throw new CodecError('bad hit kind');
          event = { e: 'shot', shooter, endX, endY, endZ, hit, target: r.u16() };
          break;
        }
        case EventType.Kill:
          event = { e: 'kill', killer: r.u16(), victim: r.u16() };
          break;
        case EventType.Joined:
          event = { e: 'joined', id: r.u16(), name: r.string(MAX_NAME_LENGTH) };
          break;
        case EventType.Left:
          event = { e: 'left', id: r.u16() };
          break;
        default:
          throw new CodecError(`unknown event type ${kind}`);
      }
      r.end();
      return { t: 'event', event };
    }
    case ServerType.Pong: {
      const clientTime = r.f64();
      const tick = r.u32();
      r.end();
      return { t: 'pong', clientTime, tick };
    }
    default:
      throw new CodecError(`unknown server message type ${type}`);
  }
}
