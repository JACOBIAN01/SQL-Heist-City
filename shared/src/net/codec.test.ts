import { describe, expect, it } from 'vitest';
import { quantiseLag, quantisePitch, quantiseYaw } from '../sim/input';
import {
  CodecError,
  decodeClientMessage,
  decodeServerMessage,
  decodeServerMessages,
  encodeBundle,
  encodeClientMessage,
  encodeServerMessage,
} from './codec';
import { Flag, type GameEvent, type ServerMessage } from './gameMessages';
import { SnapshotDecoder, SnapshotEncoder } from './snapshotCodec';

const command = (seq: number, over = {}) => ({
  seq,
  moveX: 127,
  moveY: -127,
  yaw: 1.2345,
  pitch: -0.4,
  buttons: 5,
  viewLagMs: 120,
  ...over,
});

describe('client messages', () => {
  it('round-trips join', () => {
    const m = { t: 'join', protocol: 1, name: 'Zoë' } as const;
    expect(decodeClientMessage(encodeClientMessage(m))).toEqual(m);
  });

  it('round-trips input commands, quantising angles and lag', () => {
    const decoded = decodeClientMessage(
      encodeClientMessage({ t: 'input', commands: [command(65535), command(0, { buttons: 0 })] }),
    );
    expect(decoded.t).toBe('input');
    if (decoded.t !== 'input') return;
    expect(decoded.commands).toHaveLength(2);
    const first = decoded.commands[0];
    expect(first?.seq).toBe(65535);
    expect(first?.yaw).toBeCloseTo(quantiseYaw(1.2345), 10);
    expect(first?.pitch).toBeCloseTo(quantisePitch(-0.4), 10);
    expect(first?.viewLagMs).toBe(quantiseLag(120));
    expect(first?.moveY).toBe(-127);
  });

  it('keeps the quantised angle stable: quantising twice changes nothing', () => {
    const once = quantiseYaw(5.5);
    expect(quantiseYaw(once)).toBe(once);
    expect(quantisePitch(quantisePitch(0.7))).toBe(quantisePitch(0.7));
  });

  it('is compact: 10 bytes per command', () => {
    expect(encodeClientMessage({ t: 'input', commands: [command(1)] }).length).toBe(2 + 10);
  });

  it('round-trips ping', () => {
    const m = { t: 'ping', clientTime: 1234567.5 } as const;
    expect(decodeClientMessage(encodeClientMessage(m))).toEqual(m);
  });

  it('rejects empty and oversized command batches on encode', () => {
    expect(() => encodeClientMessage({ t: 'input', commands: [] })).toThrow(CodecError);
    expect(() =>
      encodeClientMessage({
        t: 'input',
        commands: Array.from({ length: 9 }, (_, i) => command(i)),
      }),
    ).toThrow(CodecError);
  });

  it('rejects an over-long name', () => {
    expect(() => encodeClientMessage({ t: 'join', protocol: 1, name: 'x'.repeat(30) })).toThrow(
      CodecError,
    );
  });

  it('treats −128 sticks as −127', () => {
    const bytes = encodeClientMessage({ t: 'input', commands: [command(1)] });
    bytes[4] = 0x80; // moveX = −128
    const decoded = decodeClientMessage(bytes);
    expect(decoded.t === 'input' && decoded.commands[0]?.moveX).toBe(-127);
  });
});

describe('hostile or broken frames never crash the decoder', () => {
  it.each([
    ['empty', new Uint8Array([])],
    ['unknown type', new Uint8Array([0x7f])],
    ['truncated input', new Uint8Array([0x02, 0x03, 0x00])],
    ['zero commands', new Uint8Array([0x02, 0x00])],
    ['too many commands', new Uint8Array([0x02, 0xff])],
    ['join with huge name length', new Uint8Array([0x01, 0x01, 0xff, 0x41])],
    ['trailing bytes', new Uint8Array([0x03, 0, 0, 0, 0, 0, 0, 0, 0, 9])],
    ['NaN ping', new Uint8Array([0x03, 0, 0, 0, 0, 0, 0, 0xf8, 0x7f])],
    ['invalid utf-8 name', new Uint8Array([0x01, 0x01, 0x01, 0xff])],
  ])('%s', (_name, bytes) => {
    expect(() => decodeClientMessage(bytes)).toThrow(CodecError);
  });

  it('fuzz: random bytes either decode or throw CodecError, nothing else', () => {
    let seed = 1;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 0xff;
    for (let i = 0; i < 2000; i++) {
      const bytes = Uint8Array.from({ length: rand() % 40 }, rand);
      try {
        decodeClientMessage(bytes);
      } catch (error) {
        expect(error).toBeInstanceOf(CodecError);
      }
      try {
        decodeServerMessage(bytes);
      } catch (error) {
        expect(error).toBeInstanceOf(CodecError);
      }
    }
  });
});

describe('server messages', () => {
  const entity = (id: number) => ({
    id,
    x: 1.5,
    y: 0,
    z: -3.26,
    yaw: quantiseYaw(2),
    pitch: quantisePitch(0.1),
    flags: Flag.Alive | Flag.OnGround,
    hp: 77,
  });

  it('round-trips welcome', () => {
    const m: ServerMessage = {
      t: 'welcome',
      playerId: 9,
      tick: 123456,
      tickRate: 20,
      mapId: 'sandbox',
    };
    expect(decodeServerMessage(encodeServerMessage(m))).toEqual(m);
  });

  it('round-trips a snapshot (positions on the 2 cm grid, velocities to 1 mm/s)', () => {
    const m: ServerMessage = {
      t: 'snapshot',
      tick: 99,
      ackSeq: 4242,
      self: { x: 1.5, y: 2, z: 3.25, vx: 0.5, vy: -1, vz: 0, flags: Flag.Alive, hp: 100 },
      entities: Array.from({ length: 50 }, (_, i) => entity(i + 1)),
      removed: [900, 901],
    };
    const decoded = decodeServerMessage(encodeServerMessage(m));
    if (decoded.t !== 'snapshot' || m.t !== 'snapshot') throw new Error('not a snapshot');
    expect(decoded).toMatchObject({ tick: 99, ackSeq: 4242, removed: [900, 901], self: m.self });
    expect(decoded.entities).toHaveLength(50);
    decoded.entities.forEach((e, i) => {
      const sent = m.entities[i];
      expect(e.id).toBe(sent?.id);
      expect(e.x).toBeCloseTo(sent?.x ?? 0, 1);
      expect(e.z).toBeCloseTo(sent?.z ?? 0, 1);
      expect(e.yaw).toBeCloseTo(sent?.yaw ?? 0, 1);
      expect(e.pitch).toBeCloseTo(sent?.pitch ?? 0, 1);
      expect([e.flags, e.hp]).toEqual([sent?.flags, sent?.hp]);
    });
  });

  it('rejects a snapshot whose entity count lies', () => {
    const bytes = encodeServerMessage({
      t: 'snapshot',
      tick: 1,
      ackSeq: 1,
      self: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, flags: 0, hp: 0 },
      entities: [],
      removed: [],
    });
    bytes[1 + 4 + 2 + 20] = 200; // claim 200 entities that are not there
    expect(() => decodeServerMessage(bytes)).toThrow(CodecError);
  });

  it.each<GameEvent>([
    { e: 'shot', shooter: 3, endX: 1, endY: 1.5, endZ: -20, hit: 'head', target: 7 },
    { e: 'shot', shooter: 3, endX: 0, endY: 0, endZ: 0, hit: 'miss', target: 0 },
    { e: 'kill', killer: 3, victim: 7 },
    { e: 'joined', id: 12, name: 'Ana' },
    { e: 'left', id: 12 },
  ])('round-trips event %j', (event) => {
    const m: ServerMessage = { t: 'event', event };
    expect(decodeServerMessage(encodeServerMessage(m))).toEqual(m);
  });

  it('round-trips pong', () => {
    const m: ServerMessage = { t: 'pong', clientTime: 99.5, tick: 7 };
    expect(decodeServerMessage(encodeServerMessage(m))).toEqual(m);
  });
});

describe('bundles', () => {
  const welcome = { t: 'welcome', playerId: 1, tick: 5, tickRate: 20, mapId: 'm' } as const;
  const kill = { t: 'event', event: { e: 'kill', killer: 1, victim: 2 } } as const;

  it('carries several messages in one frame and decodes them in order', () => {
    const frame = encodeBundle([encodeServerMessage(welcome), encodeServerMessage(kill)]);
    expect(decodeServerMessages(frame)).toEqual([welcome, kill]);
  });

  it('passes a plain single message through as a list of one', () => {
    expect(decodeServerMessages(encodeServerMessage(kill))).toEqual([kill]);
  });

  it('can use only the first `count` parts of a longer reusable array', () => {
    const parts = [
      encodeServerMessage(welcome),
      encodeServerMessage(kill),
      encodeServerMessage(kill),
    ];
    expect(decodeServerMessages(encodeBundle(parts, 2))).toEqual([welcome, kill]);
  });

  it('rejects a bundle whose part lengths lie, or that has trailing bytes', () => {
    const frame = encodeBundle([encodeServerMessage(kill)]);
    new DataView(frame.buffer).setUint16(2, 500, true);
    expect(() => decodeServerMessages(frame)).toThrow(CodecError);
    const padded = new Uint8Array([...encodeBundle([encodeServerMessage(kill)]), 9]);
    expect(() => decodeServerMessages(padded)).toThrow(CodecError);
  });

  it('keeps snapshot baselines consistent when a snapshot arrives inside a bundle', () => {
    const encoder = new SnapshotEncoder();
    const decoder = new SnapshotDecoder();
    const snap = (x: number): ServerMessage => ({
      t: 'snapshot',
      tick: 1,
      ackSeq: 1,
      self: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, flags: 4, hp: 100 },
      entities: [{ id: 2, x, y: 0, z: 0, yaw: 0, pitch: 0, flags: 6, hp: 100 }],
      removed: [],
    });
    const first = decodeServerMessages(
      encodeBundle([encodeServerMessage(snap(10), encoder), encodeServerMessage(kill)]),
      decoder,
    );
    expect(first[0]?.t).toBe('snapshot');
    // The next snapshot is a delta against the first: it only decodes if the baseline survived the bundle.
    const second = decodeServerMessages(encodeServerMessage(snap(10.2), encoder), decoder);
    expect(second[0]?.t === 'snapshot' && second[0].entities[0]?.x).toBeCloseTo(10.2, 1);
  });
});
