import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  TEST_MAP,
  Button,
  DEFAULT_MOVEMENT_SETTINGS,
  SIM_DT,
  box,
  stepBody,
  createBody,
  type InputCommand,
  type GameMap,
} from '@heist/shared';
import { CLOSE_FULL, CLOSE_IDLE, CLOSE_PROTOCOL, Match } from './Match';
import { FakeConnection } from './testing';

const make = (maxPlayers = 100, clock = { t: 0 }) => ({
  clock,
  match: new Match({
    map: TEST_MAP,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers },
    now: () => clock.t,
  }),
});
const join = (match: Match, name = 'Ana') => {
  const connection = new FakeConnection();
  const result = match.join(PROTOCOL_VERSION, name, connection);
  return { connection, result };
};

describe('Match: join and leave', () => {
  it('welcomes a player with their id and the tick rate', () => {
    const { match } = make();
    const { connection, result } = join(match);
    expect(result.ok).toBe(true);
    const [welcome] = connection.of('welcome');
    expect(welcome).toMatchObject({ tickRate: 20, mapId: 'sandbox' });
    expect(welcome?.playerId).toBe(result.ok ? result.player.id : -1);
  });

  it('introduces players to each other', () => {
    const { match } = make();
    const a = join(match, 'Ana');
    const b = join(match, 'Ben');
    const toA = a.connection.of('event').map((m) => m.event);
    expect(toA).toContainEqual(expect.objectContaining({ e: 'joined', name: 'Ben' }));
    const toB = b.connection.of('event').map((m) => m.event);
    expect(toB).toContainEqual(expect.objectContaining({ e: 'joined', name: 'Ana' }));
  });

  it('rejects the wrong protocol version and a full match', () => {
    const { match } = make(1);
    const old = new FakeConnection();
    const bad = match.join(PROTOCOL_VERSION + 1, 'x', old);
    expect(bad).toMatchObject({ ok: false, code: CLOSE_PROTOCOL });
    join(match);
    expect(join(match, 'late').result).toMatchObject({ ok: false, code: CLOSE_FULL });
  });

  it('tells everyone when a player leaves, and ignores unknown ids', () => {
    const { match } = make();
    const a = join(match, 'Ana');
    const b = join(match, 'Ben');
    a.connection.clear();
    match.leave(b.result.ok ? b.result.player.id : 0);
    expect(a.connection.of('event')[0]?.event).toMatchObject({ e: 'left' });
    expect(() => match.leave(999)).not.toThrow();
    expect(match.players.size).toBe(1);
  });

  it('never reuses an id that is still in play and spawns players apart', () => {
    const { match } = make();
    const ids = new Set<number>();
    const spots = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const r = join(match, `p${i}`).result;
      if (r.ok) {
        ids.add(r.player.id);
        spots.add(`${r.player.body.x.toFixed(1)},${r.player.body.z.toFixed(1)}`);
      }
    }
    expect(ids.size).toBe(12);
    expect(spots.size).toBe(12);
  });

  it('cleans names: trims, strips control characters, falls back when empty', () => {
    const { match } = make();
    const a = join(match, '  \u0007Zoë\n ').result;
    const b = join(match, '   ').result;
    expect(a.ok && a.player.name).toBe('Zoë');
    expect(b.ok && b.player.name).toMatch(/^Player \d+$/);
  });
});

describe('Match: ticking', () => {
  it('sends every player a snapshot with themselves and the others', () => {
    const { match } = make();
    const a = join(match, 'Ana');
    const b = join(match, 'Ben');
    a.connection.clear();
    b.connection.clear();
    match.step();
    const [snap] = a.connection.of('snapshot');
    expect(snap?.tick).toBe(1);
    expect(snap?.entities).toHaveLength(1);
    expect(snap?.entities[0]?.id).toBe(b.result.ok ? b.result.player.id : -1);
    expect(b.connection.of('snapshot')[0]?.entities).toHaveLength(1);
  });

  it('drops players who go silent and tells the rest', () => {
    const { match, clock } = make();
    const a = join(match, 'Ana');
    const b = join(match, 'Ben');
    a.connection.clear();
    clock.t = DEFAULT_MATCH_SETTINGS.idleTimeoutMs - 1;
    match.touch(a.result.ok ? a.result.player.id : 0);
    clock.t = DEFAULT_MATCH_SETTINGS.idleTimeoutMs + 5;
    match.step();
    expect(b.connection.closed?.code).toBe(CLOSE_IDLE);
    expect(match.players.size).toBe(1);
    expect(a.connection.of('event').some((m) => m.event.e === 'left')).toBe(true);
  });
});

const cmd = (seq: number, over: Partial<InputCommand> = {}): InputCommand => ({
  seq,
  moveX: 0,
  moveY: 127,
  yaw: 0,
  pitch: 0,
  buttons: 0,
  viewLagMs: 0,
  ...over,
});
const batch = (from: number, count: number, over: Partial<InputCommand> = {}) =>
  Array.from({ length: count }, (_, i) => cmd(from + i, over));

function joined(map: GameMap = TEST_MAP, settings = DEFAULT_MATCH_SETTINGS) {
  const match = new Match({ map, settings });
  const connection = new FakeConnection();
  const result = match.join(PROTOCOL_VERSION, 'Ana', connection);
  if (!result.ok) throw new Error('join failed');
  return { match, connection, player: result.player };
}

describe('Match: server-side movement', () => {
  it('moves the player with the same simulation the client predicts with', () => {
    const { match, connection, player } = joined();
    const start = { x: player.body.x, z: player.body.z };
    const commands = batch(1, 6, { yaw: player.yaw });
    match.receiveInput(player.id, commands);
    match.step();

    const predicted = createBody(start.x, 0, start.z);
    for (const c of commands) stepBody(predicted, c, SIM_DT, TEST_MAP, DEFAULT_MOVEMENT_SETTINGS);
    expect(player.body.x).toBeCloseTo(predicted.x, 10);
    expect(player.body.z).toBeCloseTo(predicted.z, 10);

    const snap = connection.of('snapshot').at(-1);
    expect(snap?.ackSeq).toBe(6);
    expect(snap?.self.x).toBeCloseTo(predicted.x, 4);
  });

  it('applies at most maxCommandsPerTick per tick (no speed hacking)', () => {
    const { match, player } = joined();
    match.receiveInput(player.id, batch(1, 8));
    match.receiveInput(player.id, batch(9, 8));
    match.receiveInput(player.id, batch(17, 8));
    match.step();
    expect(player.lastAppliedSeq).toBe(DEFAULT_MATCH_SETTINGS.maxCommandsPerTick);
    match.step();
    expect(player.lastAppliedSeq).toBe(2 * DEFAULT_MATCH_SETTINGS.maxCommandsPerTick);
  });

  it('cannot cover more ground than the speed limit allows over time', () => {
    const { match, player } = joined();
    const start = { x: player.body.x, z: player.body.z };
    let seq = 1;
    const ticks = 40;
    for (let t = 0; t < ticks; t++) {
      match.receiveInput(player.id, batch(seq, 8, { buttons: Button.Sprint, yaw: player.yaw }));
      seq += 8;
      match.step();
    }
    const travelled = Math.hypot(player.body.x - start.x, player.body.z - start.z);
    const seconds = (ticks * DEFAULT_MATCH_SETTINGS.maxCommandsPerTick) / 60;
    expect(travelled).toBeLessThanOrEqual(DEFAULT_MOVEMENT_SETTINGS.sprintSpeed * seconds + 0.5);
  });

  it('ignores replayed and stale commands', () => {
    const { match, player } = joined();
    match.receiveInput(player.id, batch(1, 3));
    match.step();
    const after = { x: player.body.x, z: player.body.z };
    match.receiveInput(player.id, batch(1, 3));
    match.step();
    expect(player.queue).toHaveLength(0);
    expect(player.body.x).toBe(after.x);
    expect(player.body.z).toBe(after.z);
  });

  it('drops the oldest commands when the queue overflows', () => {
    const { match, player } = joined(TEST_MAP, { ...DEFAULT_MATCH_SETTINGS, inputQueueLimit: 10 });
    for (let i = 0; i < 5; i++) match.receiveInput(player.id, batch(1 + i * 8, 8));
    expect(player.queue).toHaveLength(10);
    expect(player.queue[0]?.seq).toBe(31);
  });

  it('keeps players out of walls', () => {
    const wall: GameMap = {
      id: 'w',
      halfSize: 50,
      boxes: [box('wall', 0, -5, 20, 4, 1)],
      spawns: [{ x: 0, z: 0, yaw: 0 }],
    };
    const { match, player } = joined(wall);
    let seq = 1;
    for (let t = 0; t < 60; t++) {
      match.receiveInput(player.id, batch(seq, 6));
      seq += 6;
      match.step();
    }
    expect(player.body.z).toBeGreaterThan(-4.5);
  });

  it('records facing and jump state from the commands', () => {
    const { match, connection, player } = joined();
    match.receiveInput(player.id, [cmd(1, { yaw: 1.5, pitch: 0.3, buttons: Button.Jump })]);
    match.step();
    expect(player.yaw).toBeCloseTo(1.5);
    expect(player.body.onGround).toBe(false);
    const snap = connection.of('snapshot').at(-1);
    expect((snap?.self.flags ?? 0) & 2).toBe(0);
  });

  it('does not move a dead player and discards their input', () => {
    const { match, player } = joined();
    player.alive = false;
    player.respawnAtTick = Number.MAX_SAFE_INTEGER;
    const before = player.body.z;
    match.receiveInput(player.id, batch(1, 5));
    match.step();
    expect(player.queue).toHaveLength(0);
    // Acknowledged (so the client stops replaying it) but never simulated.
    expect(player.lastAppliedSeq).toBe(5);
    expect(player.body.z).toBe(before);
  });
});
