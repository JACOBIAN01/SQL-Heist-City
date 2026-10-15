import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
  type HeistSettings,
} from '@heist/shared';
import { CLOSE_DUPLICATE, CLOSE_ROUND, Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

const quick: HeistSettings = {
  ...DEFAULT_HEIST_SETTINGS,
  locksPerVault: 1,
  roundMinutes: 0.2, // 12 s
  joinWindowMinutes: 0.1, // 6 s
  overtimeSeconds: 3,
  intermissionSeconds: 2,
};

function setup() {
  const match = new Match({
    map: HEIST_MAP,
    settings: DEFAULT_MATCH_SETTINGS,
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: quick,
  });
  const join = (name: string, accountId?: number) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, name, connection, accountId);
    return { r, connection };
  };
  const wait = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 20); i++) match.step();
  };
  return { match, join, wait };
}

describe('reconnecting mid-heist (19.5)', () => {
  it('gives a signed-in player their round back, even after the join window', () => {
    const { match, join, wait } = setup();
    const first = join('Ana', 7);
    if (!first.r.ok) throw new Error('join failed');
    const ana = first.r.player;
    ana.banked = 5_000;
    ana.kills = 2;
    ana.deaths = 1;
    match.heist.giveWeapon(ana, 'rifle');
    ana.cash = 900; // carried: dropped when they drop
    wait(1);
    match.leave(ana.id);
    wait(7); // past the join window
    expect(join('Stranger').r).toMatchObject({ ok: false, code: CLOSE_ROUND });
    const back = join('Ana', 7);
    if (!back.r.ok) throw new Error(`rejoin refused: ${back.r.reason}`);
    const again = back.r.player;
    expect([again.banked, again.kills, again.deaths, again.cash]).toEqual([5_000, 2, 1, 0]);
    expect(again.arsenal.has('rifle')).toBe(true);
    expect(again.weaponId).toBe('rifle');
  });

  it('a seat is only for the round it was held in', () => {
    const { match, join, wait } = setup();
    const first = join('Ben', 8);
    if (!first.r.ok) throw new Error('join failed');
    first.r.player.banked = 3_000;
    match.leave(first.r.player.id);
    wait(12.5 + 2.5); // the round ends and the next one starts
    const back = join('Ben', 8);
    expect(back.r.ok && back.r.player.banked).toBe(0);
  });

  it('a second connection for the account takes over, holding the seat in between', () => {
    const { match, join } = setup();
    const a = join('Cy', 9);
    if (!a.r.ok) throw new Error('join failed');
    a.r.player.banked = 1_200;
    const b = join('Cy', 9);
    expect(b.r.ok).toBe(true);
    expect(a.connection.closed).toMatchObject({ code: CLOSE_DUPLICATE });
    expect(match.players.size).toBe(1);
    expect(b.r.ok && b.r.player.banked).toBe(1_200);
  });

  it('players without an account get no seat (nobody can prove it is them)', () => {
    const { match, join } = setup();
    const a = join('Dee');
    if (!a.r.ok) throw new Error('join failed');
    a.r.player.banked = 700;
    match.leave(a.r.player.id);
    const b = join('Dee');
    expect(b.r.ok && b.r.player.banked).toBe(0);
  });
});
