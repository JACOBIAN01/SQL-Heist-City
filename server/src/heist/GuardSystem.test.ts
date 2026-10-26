import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  findAnchor,
  mapById,
  raycastMap,
  type GameMap,
  type HeistSettings,
  type MapAnchor,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { beatAround } from './GuardSystem';

const city = mapById('city') as GameMap;
const vaults = city.vaults ?? [];

function setup(guards: Partial<HeistSettings['guards']> = {}, over: { maxPlayers?: number } = {}) {
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: over.maxPlayers ?? 50, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: { ...DEFAULT_HEIST_SETTINGS, guards: { ...DEFAULT_HEIST_SETTINGS.guards, ...guards } },
    seed: 'guards-test',
  });
  const join = () => {
    const r = match.join(PROTOCOL_VERSION, 'P', new FakeConnection());
    if (!r.ok) throw new Error('join failed');
    return r.player;
  };
  const seconds = (n: number) => {
    for (let i = 0; i < n * match.tickRate; i++) match.step();
  };
  const guardsOf = (vaultId: string) => {
    const v = vaults.find((x) => x.id === vaultId);
    const anchor = v && findAnchor(city, v.consoleId);
    return match.heist.guards
      .all()
      .filter(
        (g) =>
          anchor &&
          Math.hypot(g.body.x - anchor.x, g.body.z - anchor.z) < 12 &&
          Math.abs(g.body.y - anchor.y) < 2,
      );
  };
  return { match, join, seconds, guardsOf };
}

const first = vaults[0];
if (!first) throw new Error('the city has no vaults');
const foundConsole = findAnchor(city, first.consoleId);
if (!foundConsole) throw new Error('no console');
const console1: MapAnchor = foundConsole;

/** Puts a player in a clear spot on the console's floor, `d` metres from it along the first clear direction. */
function spotAt(d: number): { x: number; z: number } {
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const wall = raycastMap(
      city,
      console1.x,
      console1.y + 1.5,
      console1.z,
      Math.cos(a),
      0,
      Math.sin(a),
      d + 0.5,
    );
    if (wall === undefined)
      return { x: console1.x + Math.cos(a) * d, z: console1.z + Math.sin(a) * d };
  }
  throw new Error('no clear line from the console');
}

describe('bank guards (29.3)', () => {
  it('stand in each bank in the numbers the settings give, armed, on the vault’s floor', () => {
    const { match, seconds } = setup();
    seconds(1);
    const expected = vaults.reduce(
      (n, v) => n + (DEFAULT_HEIST_SETTINGS.guards.perBankTier[String(v.tier)] ?? 0),
      0,
    );
    expect(match.heist.guards.count).toBe(expected);
    for (const g of match.heist.guards.all()) {
      expect(g.isGuard).toBe(true);
      expect(g.weaponId).toBe('pistol');
      expect(g.alive).toBe(true);
    }
    expect(setup({ perBankTier: {} }).match.heist.guards.count).toBe(0);
  });

  it('walk a beat that never leaves their console’s room, and have a real line of sight along it', () => {
    const beat = beatAround(city, console1, 4);
    expect(beat.length).toBeGreaterThan(0);
    for (const p of beat) {
      expect(Math.hypot(p.x - console1.x, p.z - console1.z)).toBeLessThanOrEqual(4.01);
      const d = Math.hypot(p.x - console1.x, p.z - console1.z);
      if (d > 0.1) {
        const wall = raycastMap(
          city,
          console1.x,
          console1.y + 1.5,
          console1.z,
          (p.x - console1.x) / d,
          0,
          (p.z - console1.z) / d,
          d,
        );
        expect(wall).toBeUndefined();
      }
    }
  });

  it('patrol while a player is near, and stand still when nobody is', () => {
    const near = setup();
    const p = near.join();
    near.match.teleport(p, console1.x + 40, 0, console1.z + 40); // in the bank's street, within range
    near.seconds(1);
    const start = new Map(near.guardsOf(first.id).map((g) => [g.id, { x: g.body.x, z: g.body.z }]));
    near.seconds(20);
    let moved = 0;
    for (const g of near.guardsOf(first.id)) {
      const was = start.get(g.id) as { x: number; z: number };
      if (Math.hypot(g.body.x - was.x, g.body.z - was.z) > 0.5) moved++;
      expect(Math.hypot(g.body.x - console1.x, g.body.z - console1.z)).toBeLessThan(
        DEFAULT_HEIST_SETTINGS.guards.beatRadius + 2,
      );
    }
    expect(moved).toBeGreaterThan(0);

    const far = setup();
    const q = far.join();
    far.match.teleport(q, 1500, 0, 1500);
    far.seconds(1);
    const before = far.match.heist.guards.all().map((g) => [g.body.x, g.body.z]);
    far.seconds(10);
    expect(far.match.heist.guards.all().map((g) => [g.body.x, g.body.z])).toEqual(before);
  });

  it('shoot at a player they can see, and hurt them over a few seconds', () => {
    const { match, join, seconds, guardsOf } = setup();
    const p = join();
    const at = spotAt(8);
    match.teleport(p, at.x, console1.y, at.z);
    seconds(1);
    expect(guardsOf(first.id).length).toBeGreaterThan(0);
    p.hp = DEFAULT_COMBAT_SETTINGS.maxHp;
    seconds(12);
    expect(p.hp).toBeLessThan(DEFAULT_COMBAT_SETTINGS.maxHp);
  });

  it('cannot see a player on another floor, or beyond their sight', () => {
    const { match, join, seconds } = setup();
    const p = join();
    const at = spotAt(8);
    match.teleport(p, at.x, console1.y + 6, at.z); // two storeys up
    seconds(15);
    expect(p.hp).toBe(DEFAULT_COMBAT_SETTINGS.maxHp);
  });

  it('raise the alarm when a lock is opened, and go back to hold the console', () => {
    const { match, join, seconds, guardsOf } = setup();
    const p = join();
    match.teleport(p, console1.x + 40, 0, console1.z + 40);
    seconds(1);
    const g = guardsOf(first.id)[0];
    if (!g) throw new Error('no guard');
    // Pull the guard off its beat, then ring the alarm.
    match.teleport(g, console1.x + 2, console1.y, console1.z + 2);
    const vault = [...match.heist.vaults.all()].find((v) => v.spec.id === first.id);
    if (!vault) throw new Error('no vault');
    match.heist.events.publish({ type: 'lock_opened', vault, lock: 1 });
    seconds(10);
    expect(Math.hypot(g.body.x - console1.x, g.body.z - console1.z)).toBeLessThan(
      DEFAULT_HEIST_SETTINGS.guards.beatRadius + 2,
    );
  });

  it('pay a bonus to whoever brings one down, drop no cash, and are back on their floor next round', () => {
    const { match, join, seconds, guardsOf } = setup();
    const p = join();
    match.teleport(p, console1.x + 40, 0, console1.z + 40);
    seconds(1);
    const g = guardsOf(first.id)[0];
    if (!g) throw new Error('no guard');
    match.damage(g, 999, p);
    expect(g.alive).toBe(false);
    expect(p.cash).toBe(DEFAULT_HEIST_SETTINGS.guards.killBonus);
    seconds(DEFAULT_COMBAT_SETTINGS.respawnDelaySec + 2);
    expect(g.alive).toBe(true);
    expect(g.body.y).toBeGreaterThan(console1.y - 0.5); // upstairs again, not on the street
    expect(g.weaponId).toBe('pistol');
  });

  it('take no seat in the room, and do not count as players', () => {
    const { match, join, seconds } = setup({}, { maxPlayers: 3 });
    join();
    seconds(1);
    expect(match.heist.guards.count).toBeGreaterThan(3);
    expect(match.humanCount).toBe(1);
    join();
    join();
    expect(match.humanCount).toBe(3);
    expect(match.join(PROTOCOL_VERSION, 'late', new FakeConnection())).toMatchObject({ ok: false });
  });

  it('can be made sturdier or softer with the damage setting', () => {
    const sturdy = setup({ damageTakenScale: 0.5 });
    const p = sturdy.join();
    sturdy.match.teleport(p, console1.x + 40, 0, console1.z + 40);
    sturdy.seconds(1);
    const g = sturdy.guardsOf(first.id)[0];
    if (!g) throw new Error('no guard');
    const before = g.hp;
    sturdy.match.damage(g, 40, p);
    expect(before - g.hp).toBe(20);
  });
});
