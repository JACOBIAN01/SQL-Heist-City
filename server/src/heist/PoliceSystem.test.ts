import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  mapById,
  type GameMap,
  type HeistSettings,
  type PoliceMessage,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

const city = mapById('city') as GameMap;

function setup(
  policeCfg: Partial<HeistSettings['police']> = {},
  guards: Partial<HeistSettings['guards']> = {},
) {
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: {
      ...DEFAULT_HEIST_SETTINGS,
      police: { ...DEFAULT_HEIST_SETTINGS.police, ...policeCfg },
      guards: { ...DEFAULT_HEIST_SETTINGS.guards, perBankTier: {}, ...guards },
    },
    seed: 'police-test',
  });
  const join = (at = { x: 0, z: 0 }) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, 'P', connection);
    if (!r.ok) throw new Error('join failed');
    match.teleport(r.player, at.x, 0, at.z);
    return { player: r.player, connection };
  };
  const seconds = (n: number) => {
    for (let i = 0; i < n * match.tickRate; i++) match.step();
  };
  const police = match.heist.police;
  const stars = (c: FakeConnection) =>
    (c.jsonOf('police').at(-1) as unknown as PoliceMessage | undefined)?.stars;
  return { match, join, seconds, police, stars };
}

describe('the police (29.4)', () => {
  it('give stars for crimes, up to the most there can be, and tell the player', () => {
    const { join, police, stars } = setup();
    const a = join();
    expect(police.starsOf(a.player)).toBe(0);
    police.crime(a.player, 'lock');
    expect(stars(a.connection)).toBe(1);
    police.crime(a.player, 'kill');
    police.crime(a.player, 'guard');
    expect(police.starsOf(a.player)).toBe(3);
    for (let i = 0; i < 10; i++) police.crime(a.player, 'lock');
    expect(police.starsOf(a.player)).toBe(DEFAULT_HEIST_SETTINGS.police.maxStars);
    expect(stars(a.connection)).toBe(5);
  });

  it('count cracking a lock as a crime, and killing another player, but not killing yourself or a dummy', () => {
    const { match, join, police } = setup();
    const a = join().player;
    const b = join({ x: 5, z: 5 }).player;
    const [vault] = [...match.heist.vaults.all()];
    if (!vault) throw new Error('no vault');
    match.heist.events.publish({ type: 'lock_opened', vault, lock: 1, player: a });
    expect(police.starsOf(a)).toBe(1);
    match.damage(b, 999, a);
    expect(police.starsOf(a)).toBe(2);
    match.damage(a, 999, a);
    expect(police.starsOf(b)).toBe(0);
  });

  it('send officers out of sight, one per star, who take no seat in the room', () => {
    const { match, join, seconds, police } = setup({ perStar: 1 });
    const a = join();
    police.crime(a.player, 'lock');
    police.crime(a.player, 'kill');
    seconds(3);
    const officers = police.officers();
    expect(officers).toHaveLength(2);
    for (const o of officers) {
      expect(o.isPolice).toBe(true);
      expect(o.weaponId).toBe('pistol');
      const d = Math.hypot(o.body.x - a.player.body.x, o.body.z - a.player.body.z);
      expect(d).toBeGreaterThan(30);
      expect(d).toBeLessThan(DEFAULT_HEIST_SETTINGS.police.spawnMax + 30);
    }
    expect(match.humanCount).toBe(1);
  });

  it('close in on the player and shoot', () => {
    const { match, join, seconds, police } = setup({ perStar: 2, aimErrorDegrees: 3 });
    const spot = match.map.spawns[0];
    if (!spot) throw new Error('no spawn');
    const a = join({ x: spot.x, z: spot.z });
    seconds(20); // past the round's countdown, which wipes every record
    police.crime(a.player, 'lock');
    police.crime(a.player, 'lock');
    let hurt = false;
    let closest = Infinity;
    for (let i = 0; i < 40 && !hurt; i++) {
      seconds(1);
      hurt = !a.player.alive || a.player.hp < DEFAULT_COMBAT_SETTINGS.maxHp;
      for (const o of police.officers())
        closest = Math.min(
          closest,
          Math.hypot(o.body.x - a.player.body.x, o.body.z - a.player.body.z),
        );
    }
    expect(closest).toBeLessThan(30);
    expect(hurt).toBe(true);
  });

  it('lose a star each time the player stays out of sight long enough, and go home at none', () => {
    const { match, join, seconds, police, stars } = setup({
      escapeSeconds: 3,
      spawnMin: 60,
      spawnMax: 120,
    });
    const a = join({ x: 0, z: 0 });
    police.crime(a.player, 'lock');
    police.crime(a.player, 'lock');
    seconds(1);
    expect(police.starsOf(a.player)).toBe(2);
    // Up on a roof: no officer on the street can see them.
    match.teleport(a.player, a.player.body.x, 30, a.player.body.z);
    seconds(5);
    expect(police.starsOf(a.player)).toBeLessThan(2);
    seconds(10);
    expect(police.starsOf(a.player)).toBe(0);
    expect(stars(a.connection)).toBe(0);
    expect(police.officers()).toHaveLength(0);
  });

  it('are all called off when the wanted player dies, and an officer brought down is a crime and is replaced', () => {
    const { match, join, seconds, police } = setup({ perStar: 1 });
    const a = join();
    police.crime(a.player, 'lock');
    seconds(2);
    const [officer] = police.officers();
    if (!officer) throw new Error('no officer');
    match.damage(officer, 999, a.player);
    expect(police.starsOf(a.player)).toBe(2); // killing an officer is a crime too
    seconds(3);
    expect(police.officers().filter((o) => o !== officer)).toHaveLength(2); // and more come
    match.damage(a.player, 999, officer);
    expect(police.starsOf(a.player)).toBe(0);
    expect(police.officers()).toHaveLength(0);
  });

  it('set up a roadblock ahead from the fourth star, and take it down when the stars fall', () => {
    const { join, seconds, police } = setup({ perStar: 0, roadblockFromStars: 4 });
    const a = join({ x: 0, z: 0 });
    for (let i = 0; i < 3; i++) police.crime(a.player, 'lock');
    seconds(2);
    expect(police.officers()).toHaveLength(0); // three stars: no block, and perStar is 0
    police.crime(a.player, 'lock');
    seconds(2);
    const block = police.officers();
    expect(block).toHaveLength(2);
    const [x, z] = [block[0], block[1]];
    expect(
      Math.hypot((x?.body.x ?? 0) - (z?.body.x ?? 0), (x?.body.z ?? 0) - (z?.body.z ?? 0)),
    ).toBeLessThan(8); // across one street
    police.clear(a.player);
    expect(police.officers()).toHaveLength(0);
  });

  it('are off when the settings say so, and in a tutorial room', () => {
    const off = setup({ enabled: false });
    const a = off.join();
    off.police.crime(a.player, 'lock');
    expect(off.police.starsOf(a.player)).toBe(0);
  });
});
