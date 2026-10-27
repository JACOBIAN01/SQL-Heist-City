import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  mapById,
  type DiscoveryMessage,
  type GameMap,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { InMemoryCollectionStore } from '../progress/CollectionStore';

const city = mapById('city') as GameMap;
const settle = () => new Promise((r) => setTimeout(r, 0));

async function setup(accountId?: number, store = new InMemoryCollectionStore()) {
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: DEFAULT_HEIST_SETTINGS,
    seed: 'discovery-test',
  });
  match.heist.discovery.bindStore(store);
  const connection = new FakeConnection();
  const r = match.join(PROTOCOL_VERSION, 'P', connection, accountId);
  if (!r.ok) throw new Error('join failed');
  const tick = async (n = 12) => {
    for (let i = 0; i < n; i++) match.step();
    await settle();
    for (let i = 0; i < n; i++) match.step();
  };
  const last = () =>
    connection.jsonOf('discovery').at(-1) as unknown as DiscoveryMessage | undefined;
  return { match, player: r.player, heist: match.heist, store, tick, last };
}

describe('map discovery (30.5)', () => {
  it('starts with the district you stand in, and adds each new one you walk into', async () => {
    const { match, player, heist, tick, last } = await setup();
    await tick();
    expect(heist.discovery.explored(player).size).toBeGreaterThanOrEqual(1);
    const c = city.city;
    if (!c) throw new Error('no city');
    for (const d of c.districts) {
      const block = c.blocks.find((b) => b.district === d.id);
      if (!block) continue;
      match.teleport(
        player,
        (block.inner.minX + block.inner.maxX) / 2,
        0,
        (block.inner.minZ + block.inner.maxZ) / 2,
      );
      await tick();
    }
    expect([...heist.discovery.explored(player)].sort()).toEqual(
      c.districts.map((d) => d.id).sort(),
    );
    expect(last()?.districts).toHaveLength(c.districts.length);
  });

  it('keeps a signed-in student’s discoveries across matches, and not a guest’s', async () => {
    const store = new InMemoryCollectionStore();
    const one = await setup(9, store);
    await one.tick();
    const mine = [...one.heist.discovery.explored(one.player)];
    expect(mine.length).toBeGreaterThan(0);
    await settle();
    const two = await setup(9, store);
    await two.tick(); // the first pass starts loading, the second sees the result
    await settle();
    expect([...two.heist.discovery.explored(two.player)]).toEqual(expect.arrayContaining(mine));
    const before = (await store.found(9)).size;
    const guest = await setup(undefined, store);
    await guest.tick();
    expect(guest.heist.discovery.explored(guest.player).size).toBeGreaterThan(0);
    expect((await store.found(9)).size).toBe(before); // a guest saves nothing
  });
});
