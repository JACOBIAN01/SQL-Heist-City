import { describe, expect, it } from 'vitest';
import { SeededRng } from '../random/Rng';
import { CodecError } from './binary';
import { decodeServerMessage, encodeServerMessage } from './codec';
import { Flag, type EntityState, type SnapshotMessage } from './gameMessages';
import { POSITION_UNIT, SnapshotDecoder, SnapshotEncoder } from './snapshotCodec';

const self = {
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  flags: Flag.Alive,
  hp: 100,
  weapon: 3,
  ammo: 20,
};
const ent = (id: number, over: Partial<EntityState> = {}): EntityState => ({
  id,
  x: 10,
  y: 0,
  z: 20,
  yaw: 1,
  pitch: 0,
  flags: Flag.Alive | Flag.OnGround,
  hp: 100,
  ...over,
});
const snap = (tick: number, entities: EntityState[], removed: number[] = []): SnapshotMessage => ({
  t: 'snapshot',
  tick,
  ackSeq: tick,
  self,
  entities,
  removed,
});

/** A server/client pair that share baselines, as over one WebSocket. */
function link() {
  const encoder = new SnapshotEncoder();
  const decoder = new SnapshotDecoder();
  return {
    encoder,
    send: (m: SnapshotMessage) => {
      const bytes = encodeServerMessage(m, encoder);
      const out = decodeServerMessage(bytes, decoder);
      if (out.t !== 'snapshot') throw new Error('not a snapshot');
      return { bytes: bytes.length, out };
    },
  };
}

describe('delta snapshots', () => {
  it('sends a new entity in full, then nothing while it stands still', () => {
    const { send } = link();
    const first = send(snap(1, [ent(2)]));
    expect(first.out.entities).toHaveLength(1);
    const second = send(snap(2, [ent(2)]));
    expect(second.out.entities).toHaveLength(0);
    expect(second.bytes).toBeLessThan(first.bytes);
  });

  it('sends a small step as a 3-byte position delta', () => {
    const { send } = link();
    send(snap(1, [ent(2)]));
    const empty = send(snap(2, [])).bytes;
    const moved = send(snap(3, [ent(2, { x: 10.3, z: 20.1 })]));
    expect(moved.bytes - empty).toBe(2 + 1 + 3); // id, mask, dx dy dz
    expect(moved.out.entities[0]?.x).toBeCloseTo(10.3, 1);
    expect(moved.out.entities[0]?.z).toBeCloseTo(20.1, 1);
  });

  it('falls back to absolute position for jumps bigger than a delta can hold (a respawn)', () => {
    const { send } = link();
    send(snap(1, [ent(2)]));
    const jumped = send(snap(2, [ent(2, { x: 200, z: -150 })]));
    expect(jumped.out.entities[0]?.x).toBeCloseTo(200, 1);
    expect(jumped.out.entities[0]?.z).toBeCloseTo(-150, 1);
  });

  it('sends only the fields that changed', () => {
    const { send } = link();
    send(snap(1, [ent(2)]));
    const empty = send(snap(2, [])).bytes;
    const hurt = send(snap(3, [ent(2, { hp: 60 })]));
    expect(hurt.bytes - empty).toBe(2 + 1 + 1);
    expect(hurt.out.entities[0]?.hp).toBe(60);
    expect(hurt.out.entities[0]?.x).toBeCloseTo(10, 1);
  });

  it('forgets removed entities on both sides, so a returner is sent in full again', () => {
    const { send, encoder } = link();
    send(snap(1, [ent(2)]));
    expect(encoder.known).toBe(1);
    const gone = send(snap(2, [], [2]));
    expect(gone.out.removed).toEqual([2]);
    expect(encoder.known).toBe(0);
    const back = send(snap(3, [ent(2, { x: 11 })]));
    expect(back.out.entities).toHaveLength(1);
    expect(back.out.entities[0]?.x).toBeCloseTo(11, 1);
  });

  it('keeps clients independent: each sees its own baseline', () => {
    const a = link();
    const b = link();
    a.send(snap(1, [ent(2)]));
    // b has never heard of entity 2, so it still gets the full record.
    expect(b.send(snap(1, [ent(2)])).out.entities).toHaveLength(1);
  });

  it('is far smaller than the old fixed 20-byte records for moving crowds', () => {
    const { send } = link();
    const crowd = (t: number) =>
      Array.from({ length: 30 }, (_, i) =>
        ent(i + 1, { x: i * 3 + t * 0.2, z: i * 2 - t * 0.15, yaw: 1 + t * 0.01 }),
      );
    send(snap(0, crowd(0)));
    let total = 0;
    for (let t = 1; t <= 20; t++) total += send(snap(t, crowd(t))).bytes;
    const oldSize = 1 + 4 + 2 + 26 + 2 + 30 * 20;
    expect(total / 20).toBeLessThan(oldSize / 2);
  });

  it('refuses a change for an entity the client never had', () => {
    const encoder = new SnapshotEncoder();
    encodeServerMessage(snap(1, [ent(2)]), encoder); // the client never sees this one
    const bytes = encodeServerMessage(snap(2, [ent(2, { hp: 50 })]), encoder);
    expect(() => decodeServerMessage(bytes, new SnapshotDecoder())).toThrow(CodecError);
  });

  it('refuses oversized snapshots', () => {
    const encoder = new SnapshotEncoder();
    const many = Array.from({ length: 256 }, (_, i) => ent(i + 1));
    expect(() => encodeServerMessage(snap(1, many), encoder)).toThrow(CodecError);
  });

  it('server and client baselines stay identical over a long random walk', () => {
    const { send } = link();
    const rng = new SeededRng('walk');
    const truth = new Map<number, EntityState>();
    for (let tick = 1; tick <= 400; tick++) {
      const changed: EntityState[] = [];
      for (let id = 1; id <= 12; id++) {
        const prev = truth.get(id) ?? ent(id, { x: rng.int(-300, 300), z: rng.int(-300, 300) });
        const jump = rng.bool(0.02);
        const next = ent(id, {
          x: jump ? rng.int(-300, 300) : prev.x + (rng.next() - 0.5) * 0.8,
          z: jump ? rng.int(-300, 300) : prev.z + (rng.next() - 0.5) * 0.8,
          yaw: rng.next() * 6.28,
          pitch: (rng.next() - 0.5) * 2,
          hp: rng.int(0, 100),
          flags: rng.bool(0.1) ? Flag.Alive : Flag.Alive | Flag.OnGround | Flag.Crouching,
        });
        truth.set(id, next);
        if (rng.bool(0.7)) changed.push(next);
      }
      const out = send(snap(tick, changed)).out;
      for (const e of out.entities) {
        const t = truth.get(e.id) as EntityState;
        expect(Math.abs(e.x - t.x)).toBeLessThanOrEqual(POSITION_UNIT / 2 + 1e-9);
        expect(Math.abs(e.z - t.z)).toBeLessThanOrEqual(POSITION_UNIT / 2 + 1e-9);
        expect(e.hp).toBe(t.hp);
        expect(e.flags).toBe(t.flags);
      }
    }
  });
});
