import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_SETTINGS, PROTOCOL_VERSION, TEST_MAP } from '@heist/shared';
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
