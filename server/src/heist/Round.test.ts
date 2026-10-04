import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
  TEST_MAP,
  type HeistSettings,
} from '@heist/shared';
import { CLOSE_ROUND, Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { rankPlayers } from './Scoreboard';

const quick: HeistSettings = {
  ...DEFAULT_HEIST_SETTINGS,
  locksPerVault: 1,
  roundMinutes: 0.2, // 12 s
  joinWindowMinutes: 0.1, // 6 s
  overtimeSeconds: 3,
  intermissionSeconds: 2,
  scoreboardEverySec: 1,
};

function setup(heist: HeistSettings = quick, map = HEIST_MAP) {
  const match = new Match({
    map,
    settings: DEFAULT_MATCH_SETTINGS,
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist,
  });
  const join = (name: string) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, name, connection);
    if (!r.ok) throw new Error(`join failed: ${r.reason}`);
    r.player.protectedUntilTick = 0;
    return { player: r.player, connection };
  };
  const wait = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 20); i++) match.step();
  };
  return { match, join, wait };
}

const rounds = (c: FakeConnection) => c.jsonOf('round');

describe('ranking', () => {
  it('orders by banked cash, then kills, then who joined first; dummies are left out', () => {
    const { match, join } = setup();
    const a = join('A');
    const b = join('B');
    const c = join('C');
    const dummy = match.addDummy('Dummy', { x: 0, z: 0, yaw: 0 });
    a.player.banked = 100;
    b.player.banked = 300;
    c.player.banked = 100;
    c.player.kills = 2;
    dummy.banked = 9_999;
    expect(rankPlayers(match.playerList()).map((p) => p.name)).toEqual(['B', 'C', 'A']);
  });
});

describe('the round', () => {
  it('tells a joining player how long is left', () => {
    const { join, wait } = setup();
    wait(2);
    const a = join('A');
    expect(rounds(a.connection)[0]).toEqual({ t: 'round', phase: 'playing', endsInSec: 10 });
  });

  it('ends on the timer with the player who banked most as winner', () => {
    const { join, wait } = setup();
    const a = join('A');
    const b = join('B');
    a.player.banked = 5_000;
    b.player.banked = 9_000;
    wait(12.5);
    const over = rounds(a.connection).at(-1);
    expect(over).toMatchObject({ phase: 'ended', winner: { name: 'B', banked: 9_000 } });
    expect(over && 'standings' in over && over.standings.map((s) => s.name)).toEqual(['B', 'A']);
  });

  it('has no winner when nobody banked anything', () => {
    const { join, wait } = setup();
    const a = join('A');
    wait(12.5);
    expect(rounds(a.connection).at(-1)).toMatchObject({ phase: 'ended', winner: null });
  });

  it('freezes the fight, tasks and interactions between rounds', async () => {
    const { match, join, wait } = setup();
    const a = join('A');
    const b = join('B');
    wait(12.5);
    match.damage(a.player, 50, b.player);
    expect(a.player.hp).toBe(DEFAULT_COMBAT_SETTINGS.maxHp);
    a.connection.clear();
    match.receiveJson(
      a.player.id,
      JSON.stringify({ t: 'interact', ref: 1, anchor: 'safehouse-1' }),
    );
    expect(a.connection.jsonOf('interact_result')[0]?.result).toEqual({
      action: 'denied',
      reason: 'round_over',
    });
    match.receiveJson(
      a.player.id,
      JSON.stringify({ t: 'challenge_request', ref: 2, rewardKey: 'heal:small' }),
    );
    expect(a.connection.jsonOf('challenge')[0]?.result).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
  });

  it('starts a fresh round after the intermission: scores, vaults, bags and players reset', () => {
    const { match, join, wait } = setup();
    const a = join('A');
    const b = join('B');
    a.player.banked = 7_000;
    a.player.kills = 3;
    match.heist.giveWeapon(a.player, 'rifle');
    match.heist.openLock('bank-1:vault', 1);
    b.player.hp = 10;
    wait(12.5);
    expect(match.heist.round?.phase).toBe('ended');
    wait(2.5);
    expect(match.heist.round?.phase).toBe('playing');
    expect(a.player.banked).toBe(0);
    expect(a.player.kills).toBe(0);
    expect(a.player.weaponId).toBe('');
    expect(b.player.hp).toBe(DEFAULT_COMBAT_SETTINGS.maxHp);
    expect(match.heist.vaults.get('bank-1:vault')?.locksOpen).toBe(0);
    expect(match.heist.loot.count).toBe(0);
    expect(a.connection.jsonOf('vaults').at(-1)?.vaults[0]?.opened).toBe(0);
    expect(rounds(a.connection).at(-1)).toMatchObject({ phase: 'playing' });
    expect(a.connection.jsonOf('purse').at(-1)).toMatchObject({ carried: 0, banked: 0 });
  });
});

describe('finishing early', () => {
  it('ends a few seconds after every vault is open and its loot gone', () => {
    const { match, join, wait } = setup({ ...quick, roundMinutes: 5 });
    const a = join('A');
    match.heist.openLock('bank-1:vault', 1);
    wait(1);
    expect(match.heist.round?.phase).toBe('playing'); // bags still on the floor
    for (const bag of match.heist.loot.all()) match.heist.loot.remove(bag.id);
    wait(1);
    expect(match.heist.round?.phase).toBe('playing');
    expect(rounds(a.connection).at(-1)).toMatchObject({ phase: 'playing', endsInSec: 3 });
    wait(3.5);
    expect(match.heist.round?.phase).toBe('ended');
  });

  it('does not end early while a vault is still shut', () => {
    const { match, wait } = setup({ ...quick, roundMinutes: 5 });
    wait(8);
    expect(match.heist.round?.phase).toBe('playing');
  });
});

describe('joining', () => {
  it('is open early in a round, closed late, and open again between rounds', () => {
    const { match, wait } = setup();
    const early = new FakeConnection();
    expect(match.join(PROTOCOL_VERSION, 'Early', early).ok).toBe(true);
    wait(7);
    const late = match.join(PROTOCOL_VERSION, 'Late', new FakeConnection());
    expect(late).toMatchObject({ ok: false, code: CLOSE_ROUND });
    wait(5.5); // the round ends at 12 s
    expect(match.join(PROTOCOL_VERSION, 'Between', new FakeConnection()).ok).toBe(true);
  });

  it('is always open on the sandbox, which has no rounds', () => {
    const { match, wait } = setup(quick, TEST_MAP);
    wait(30);
    expect(match.heist.round).toBeUndefined();
    expect(match.join(PROTOCOL_VERSION, 'A', new FakeConnection()).ok).toBe(true);
  });
});

describe('scoreboard', () => {
  it('broadcasts the leaders and tells each player their rank only when it changes', () => {
    const { join, wait } = setup();
    const a = join('A');
    const b = join('B');
    a.player.banked = 200;
    b.player.banked = 100;
    wait(1.2);
    const scores = a.connection.jsonOf('scores').at(-1);
    expect(scores?.top.map((s) => [s.name, s.banked])).toEqual([
      ['A', 200],
      ['B', 100],
    ]);
    expect(a.connection.jsonOf('standing').at(-1)).toMatchObject({ rank: 1, players: 2 });
    expect(b.connection.jsonOf('standing').at(-1)).toMatchObject({ rank: 2, players: 2 });
    const before = a.connection.jsonOf('standing').length;
    wait(2.2);
    expect(a.connection.jsonOf('standing')).toHaveLength(before); // unchanged: not repeated
    b.player.banked = 500;
    wait(1.2);
    expect(a.connection.jsonOf('standing').at(-1)).toMatchObject({ rank: 2 });
  });

  it('shows only the top ten', () => {
    const { join, wait } = setup();
    const players = Array.from({ length: 12 }, (_, i) => join(`P${i}`));
    players.forEach((p, i) => (p.player.banked = i * 10));
    wait(1.2);
    const top = players[0]?.connection.jsonOf('scores').at(-1)?.top ?? [];
    expect(top).toHaveLength(10);
    expect(top[0]?.name).toBe('P11');
    expect(players[0]?.connection.jsonOf('standing').at(-1)).toMatchObject({
      rank: 12,
      players: 12,
    });
  });
});
