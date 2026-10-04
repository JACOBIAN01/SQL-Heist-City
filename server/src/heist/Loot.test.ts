import { describe, expect, it } from 'vitest';
import {
  Button,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  Flag,
  HEIST_MAP,
  PROTOCOL_VERSION,
  type ChallengeServerMessage,
  type InputCommand,
} from '@heist/shared';
import { Match, flagsOf } from '../game/Match';
import type { Player } from '../game/Player';
import { FakeConnection } from '../game/testing';
import type { ChallengeGateway } from './ChallengeGateway';
import { LootManager } from './LootManager';

function setup(gateway?: ChallengeGateway) {
  const match = new Match({
    map: HEIST_MAP,
    settings: DEFAULT_MATCH_SETTINGS,
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: { ...DEFAULT_HEIST_SETTINGS, locksPerVault: 1 },
    ...(gateway ? { challenges: gateway } : {}),
  });
  const join = (name: string, at = { x: 0, y: 0, z: 30 }) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, name, connection);
    if (!r.ok) throw new Error('join failed');
    Object.assign(r.player.body, at);
    return { player: r.player, connection };
  };
  return { match, join };
}

/** The 5 spots of Bank 1's vault, top storey. */
const spots = HEIST_MAP.vaults?.[0]?.loot ?? [];

describe('LootManager', () => {
  it('splits a total over parts without losing a dollar', () => {
    expect(LootManager.split(50_000, 5)).toEqual([10_000, 10_000, 10_000, 10_000, 10_000]);
    const odd = LootManager.split(100_001, 3);
    expect(odd.reduce((a, b) => a + b, 0)).toBe(100_001);
    expect(odd[0]).toBe(33_335);
    expect(LootManager.split(100, 0)).toEqual([]);
  });

  it('adds, lists and removes bags with unique ids', () => {
    const l = new LootManager();
    const a = l.add(1, 0, 2, 500);
    const b = l.add(3, 0, 4, 700);
    expect(a.id).not.toBe(b.id);
    expect(l.count).toBe(2);
    expect(l.remove(a.id)).toEqual(a);
    expect(l.remove(a.id)).toBeUndefined();
    expect(l.all()).toEqual([b]);
  });
});

describe('vault loot', () => {
  it('spills the bank-tier loot in bags at the loot spots when the vault opens', () => {
    const { match, join } = setup();
    const a = join('A');
    a.connection.clear();
    match.heist.openLock('bank-1:vault', 1);
    const loot = a.connection.jsonOf('loot')[0];
    expect(loot?.add).toHaveLength(5);
    expect(loot?.add.reduce((sum, b) => sum + b.amount, 0)).toBe(50_000);
    expect(loot?.add.map((b) => [b.x, b.z])).toEqual(spots.map((s) => [s.x, s.z]));
    expect(loot?.add.every((b) => b.y === 6)).toBe(true);
  });

  it('uses the configured loot for the tier', () => {
    const match = new Match({
      map: HEIST_MAP,
      settings: DEFAULT_MATCH_SETTINGS,
      heist: {
        ...DEFAULT_HEIST_SETTINGS,
        locksPerVault: 1,
        vaultLootByTier: { '1': 1_000 },
      },
    });
    const c = new FakeConnection();
    match.join(PROTOCOL_VERSION, 'A', c);
    c.clear();
    match.heist.openLock('bank-1:vault', 1);
    expect(c.jsonOf('loot')[0]?.add.reduce((s, b) => s + b.amount, 0)).toBe(1_000);
  });

  it('shows a newcomer the bags already lying around', () => {
    const { match, join } = setup();
    match.heist.openLock('bank-1:vault', 1);
    expect(join('Late').connection.jsonOf('loot')[0]?.add).toHaveLength(5);
  });
});

describe('picking up and carrying', () => {
  const vaultOpen = () => {
    const s = setup();
    s.match.heist.openLock('bank-1:vault', 1);
    return s;
  };
  const first = spots[0] as { x: number; z: number };

  it('picks a bag up by standing on it, once, and tells everyone it is gone', () => {
    const { match, join } = vaultOpen();
    const a = join('A', { x: first.x, y: 6, z: first.z });
    const b = join('B', { x: first.x + 0.3, y: 6, z: first.z });
    a.connection.clear();
    b.connection.clear();
    match.step();
    expect(a.player.cash + b.player.cash).toBe(10_000); // exactly one of them got it
    expect(a.connection.jsonOf('loot')[0]?.remove).toHaveLength(1);
    expect(b.connection.jsonOf('loot')[0]?.remove).toHaveLength(1);
    match.step();
    expect(a.player.cash + b.player.cash).toBe(10_000);
  });

  it('ignores bags on another floor', () => {
    const { match, join } = vaultOpen();
    const a = join('A', { x: first.x, y: 0, z: first.z });
    match.step();
    expect(a.player.cash).toBe(0);
  });

  it('ignores a dead player standing on a bag', () => {
    const { match, join } = vaultOpen();
    const a = join('A', { x: first.x, y: 6, z: first.z });
    a.player.alive = false;
    match.step();
    expect(a.player.cash).toBe(0);
  });

  it("updates the player's purse and marks them as carrying", () => {
    const { match, join } = vaultOpen();
    const a = join('A', { x: first.x, y: 6, z: first.z });
    match.step();
    const purse = a.connection.jsonOf('purse').at(-1);
    expect(purse).toEqual({ t: 'purse', carried: 10_000, banked: 0, speed: 0.99 });
    expect(flagsOf(a.player) & Flag.Carrying).toBe(Flag.Carrying);
    expect(flagsOf(join('B').player) & Flag.Carrying).toBe(0);
  });

  it('slows a player down by the cash they carry', () => {
    const { match, join } = setup();
    const heavy = join('Heavy', { x: -40, y: 0, z: 40 });
    const light = join('Light', { x: 40, y: 0, z: 40 });
    match.heist.setCash(heavy.player, 200_000);
    expect(heavy.player.speedScale).toBeCloseTo(0.8);
    const run = (seq: number): InputCommand => ({
      seq,
      moveX: 0,
      moveY: 127,
      yaw: 0,
      pitch: 0,
      buttons: Button.Sprint,
      viewLagMs: 0,
    });
    for (let i = 0; i < 20; i++) {
      for (const p of [heavy.player, light.player]) {
        match.receiveInput(p.id, [run(i * 3 + 1), run(i * 3 + 2), run(i * 3 + 3)]);
      }
      match.step();
    }
    const heavyDist = 40 - heavy.player.body.z;
    const lightDist = 40 - light.player.body.z;
    expect(heavyDist / lightDist).toBeCloseTo(0.8, 1);
  });
});

describe('dropping cash', () => {
  const setCash = (match: Match, p: Player, c: number) => match.heist.setCash(p, c);

  it('drops everything carried where the player dies, for anyone to take', () => {
    const { match, join } = setup();
    // The bullet leaves 0.55 m to the shooter's right (x - 0.55 when facing +z), so the victim stands there.
    const victim = join('V', { x: 9.45, y: 0, z: 30 });
    const killer = join('K', { x: 10, y: 0, z: 20 });
    setCash(match, victim.player, 30_000);
    victim.player.hp = 1;
    match.heist.giveWeapon(killer.player, 'rifle'); // heist players start unarmed
    // The killer shoots: facing +z means yaw π.
    const shot = (seq: number): InputCommand => ({
      seq,
      moveX: 0,
      moveY: 0,
      yaw: Math.PI,
      pitch: 0,
      buttons: Button.Fire,
      viewLagMs: 0,
    });
    killer.player.body.y = 0;
    killer.connection.clear();
    victim.connection.clear();
    match.receiveInput(killer.player.id, [shot(1)]);
    match.step();
    expect(victim.player.alive).toBe(false);
    expect(victim.player.cash).toBe(0);
    const dropped = killer.connection.jsonOf('loot')[0]?.add[0];
    expect(dropped).toMatchObject({ x: 9.45, z: 30, amount: 30_000 });
    expect(victim.connection.jsonOf('purse').at(-1)).toMatchObject({ carried: 0 });
  });

  it('lets the killer scoop the bag', () => {
    const { match, join } = setup();
    const victim = join('V', { x: 10, y: 0, z: 30 });
    const killer = join('K', { x: 10, y: 0, z: 29.5 });
    setCash(match, victim.player, 30_000);
    victim.player.hp = 1;
    match.damage(victim.player, 5, killer.player);
    match.step();
    expect(killer.player.cash).toBe(30_000);
  });

  it('drops cash when a player disconnects', () => {
    const { match, join } = setup();
    const a = join('A', { x: 10, y: 0, z: 30 });
    const b = join('B', { x: -40, y: 0, z: -40 });
    setCash(match, a.player, 12_000);
    b.connection.clear();
    match.leave(a.player.id);
    expect(b.connection.jsonOf('loot')[0]?.add[0]?.amount).toBe(12_000);
  });
});

describe('hints cost carried cash', () => {
  const gateway = (cost: number, mode: 'fraction' | 'absolute', charged = true) =>
    ({
      handle: (_p, raw) =>
        Promise.resolve({
          t: 'challenge_hint',
          ref: (raw as { ref: number }).ref,
          now: 0,
          result: { ok: true, hint: { index: 0, text: 'x', cost, costMode: mode, charged } },
        } as ChallengeServerMessage),
      playerLeft: () => {},
    }) satisfies ChallengeGateway;
  const ask = async (g: ChallengeGateway, cash: number) => {
    const { match, join } = setup(g);
    const a = join('A');
    match.heist.setCash(a.player, cash);
    match.receiveJson(
      a.player.id,
      JSON.stringify({ t: 'challenge_hint', ref: 1, challengeId: 'c', index: 0 }),
    );
    await new Promise((r) => setImmediate(r));
    return a.player;
  };

  it('takes a fraction of what you carry', async () => {
    expect((await ask(gateway(0.05, 'fraction'), 100_000)).cash).toBe(95_000);
  });
  it('takes a fixed amount, but never more than you have', async () => {
    expect((await ask(gateway(500, 'absolute'), 100_000)).cash).toBe(99_500);
    expect((await ask(gateway(500, 'absolute'), 200)).cash).toBe(0);
  });
  it('charges only the first time a hint is revealed', async () => {
    expect((await ask(gateway(0.05, 'fraction', false), 100_000)).cash).toBe(100_000);
  });
});
