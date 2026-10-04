import {
  LAG_STEP_MS,
  pitchFromWire,
  pitchToWire,
  quantiseLag,
  yawFromWire,
  yawToWire,
  type InputCommand,
} from '../sim/input';
import { CodecError, Reader, Writer, utf8 } from './binary';
import { SnapshotDecoder, SnapshotEncoder } from './snapshotCodec';
import {
  MAX_COMMANDS_PER_MESSAGE,
  MAX_JSON_BYTES,
  MAX_NAME_LENGTH,
  type ClientMessage,
  type GameEvent,
  type HitKind,
  type ServerMessage,
} from './gameMessages';
export { CodecError };

const enum ClientType {
  Join = 0x01,
  Input = 0x02,
  Ping = 0x03,
  Json = 0x04,
}
const enum ServerType {
  Welcome = 0x81,
  Snapshot = 0x82,
  Event = 0x83,
  Pong = 0x84,
  Bundle = 0x85,
  Json = 0x86,
}
const enum EventType {
  Shot = 1,
  Kill = 2,
  Joined = 3,
  Left = 4,
}

const HIT_CODES: readonly HitKind[] = ['miss', 'body', 'head'];
const COMMAND_BYTES = 10;
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
    case 'json':
      return jsonBytes(ClientType.Json, message.text);
  }
}

function jsonBytes(type: number, text: string): Uint8Array {
  const body = utf8.encode(text);
  if (body.length > MAX_JSON_BYTES) throw new CodecError('json too long');
  const out = new Uint8Array(1 + body.length);
  out[0] = type;
  out.set(body, 1);
  return out;
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
    case ClientType.Json:
      return { t: 'json', text: r.rest(MAX_JSON_BYTES) };
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

export function encodeServerMessage(
  message: ServerMessage,
  snapshots?: SnapshotEncoder,
  /** For snapshots built in reused arrays: how many entries are live. */
  counts?: { readonly entities: number; readonly removed: number },
): Uint8Array {
  switch (message.t) {
    case 'welcome':
      return new Writer(1 + 2 + 4 + 1 + stringBytes(message.mapId))
        .u8(ServerType.Welcome)
        .u16(message.playerId)
        .u32(message.tick)
        .u8(message.tickRate)
        .string(message.mapId).bytes;
    case 'snapshot':
      // Stateless callers get a fresh encoder: every entity is sent in full.
      return (snapshots ?? new SnapshotEncoder()).encode(
        message,
        ServerType.Snapshot,
        counts?.entities,
        counts?.removed,
      );
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
    case 'json':
      return jsonBytes(ServerType.Json, message.text);
    case 'pong':
      return new Writer(13).u8(ServerType.Pong).f64(message.clientTime).u32(message.tick).bytes;
  }
}

/**
 * Several server messages in one WebSocket frame: a snapshot plus the shots and
 * kills that happened this tick. One send per client per tick instead of one per
 * event matters because each send is a system call (see docs/performance.md).
 * Layout: type u8, count u8, then per part: length u16 + the part's own bytes.
 */
export function encodeBundle(parts: readonly Uint8Array[], count = parts.length): Uint8Array {
  let size = 2;
  for (let i = 0; i < count; i++) size += 2 + (parts[i] as Uint8Array).length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out[0] = ServerType.Bundle;
  out[1] = count;
  let at = 2;
  for (let i = 0; i < count; i++) {
    const part = parts[i] as Uint8Array;
    view.setUint16(at, part.length, true);
    out.set(part, at + 2);
    at += 2 + part.length;
  }
  return out;
}

/** Decodes a frame that may be a single message or a bundle; always returns a list. */
export function decodeServerMessages(
  bytes: Uint8Array,
  snapshots?: SnapshotDecoder,
): ServerMessage[] {
  if (bytes[0] !== ServerType.Bundle) return [decodeServerMessage(bytes, snapshots)];
  const r = new Reader(bytes);
  r.u8();
  const count = r.u8();
  const messages: ServerMessage[] = [];
  let at = 2;
  for (let i = 0; i < count; i++) {
    const length = r.u16();
    at += 2;
    if (at + length > bytes.length) throw new CodecError('bundle part exceeds frame');
    messages.push(decodeServerMessage(bytes.subarray(at, at + length), snapshots));
    for (let k = 0; k < length; k++) r.u8();
    at += length;
  }
  r.end();
  return messages;
}

export function decodeServerMessage(bytes: Uint8Array, snapshots?: SnapshotDecoder): ServerMessage {
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
    case ServerType.Snapshot:
      return (snapshots ?? new SnapshotDecoder()).decode(r);
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
    case ServerType.Json:
      return { t: 'json', text: r.rest(MAX_JSON_BYTES) };
    default:
      throw new CodecError(`unknown server message type ${type}`);
  }
}
