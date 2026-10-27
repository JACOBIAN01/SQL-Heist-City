import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  mapById,
  type CachesMessage,
  type GameMap,
  type HeistSettings,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

const city = mapById('city') as GameMap;

function setup(caches: Partial<HeistSettings['caches']> = {}) {
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: {
      ...DEFAULT_HEIST_SETTINGS,
      // Chips stand on the same open ground; keep them out of these tests.
      collectibles: { ...DEFAULT_HEIST_SETTINGS.collectibles, enabled: false },
      caches: { ...DEFAULT_HEIST_SETTINGS.caches, ...caches },
    },
    seed: 'cache-test',
  });
  const connection = new FakeConnection();
  const r = match.join(PROTOCOL_VERSION, 'P', connection);
  if (!r.ok) throw new Error('join failed');
  const heist = match.heist;
  heist.caches.reset();
  const last = () => connection.jsonOf('caches').at(-1) as unknown as CachesMessage | undefined;
  const go = (x: number, z: number) => match.teleport(r.player, x, 0, z);
  return { match, player: r.player, heist, last, go, connection };
}

describe('hidden caches (30.2)', () => {
  it('hide the asked number somewhere new each round, apart from each other', () => {
    const { heist } = setup({ count: 6 });
    const first = heist.caches.live().map((c) => `${c.x},${c.z}`);
    expect(first).toHaveLength(6);
    expect(new Set(first).size).toBe(6);
    heist.caches.reset();
    expect(heist.caches.live().map((c) => `${c.x},${c.z}`)).not.toEqual(first);
  });

  it('tell a player only about the ones near them', () => {
    const { match, heist, last, go } = setup({ revealRange: 30 });
    const [near, ...rest] = heist.caches.live();
    if (!near) throw new Error('no cache');
    go(near.x + 20, near.z);
    match.step();
    expect(last()?.caches.map((c) => c.id)).toContain(near.id);
    for (const other of rest)
      if (Math.hypot(other.x - near.x - 20, other.z - near.z) > 30)
        expect(last()?.caches.map((c) => c.id)).not.toContain(other.id);
    go(near.x + 150, near.z);
    match.step();
    expect(last()?.caches.map((c) => c.id) ?? []).not.toContain(near.id);
  });

  it('pay the carried cash once when walked over, and are gone for everyone', () => {
    const { match, player, heist, last, go } = setup({ amount: 1_500 });
    const [site] = heist.caches.live();
    if (!site) throw new Error('no cache');
    const before = heist.caches.live().length;
    go(site.x, site.z);
    match.step();
    expect(player.cash).toBe(1_500);
    expect(last()?.found).toEqual({ amount: 1_500 });
    expect(heist.caches.live()).toHaveLength(before - 1);
    match.step();
    match.step();
    expect(player.cash).toBe(1_500);
  });

  it('can be revealed from afar by intel', () => {
    const { match, player, heist, last, go } = setup();
    const [site] = heist.caches.live();
    if (!site) throw new Error('no cache');
    go(site.x + 150, site.z);
    heist.caches.reveal(player, [site.id]);
    match.step();
    expect(last()?.caches.map((c) => c.id)).toContain(site.id);
  });

  it('are off when the setting says so, and a dead player cannot take one', () => {
    const off = setup({ enabled: false });
    expect(off.heist.caches.live()).toHaveLength(0);
    const { match, player, heist, go } = setup();
    const [site] = heist.caches.live();
    if (!site) throw new Error('no cache');
    player.alive = false;
    go(site.x, site.z);
    match.step();
    expect(player.cash).toBe(0);
  });
});
