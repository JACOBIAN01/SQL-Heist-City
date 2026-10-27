import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  mapById,
  type CollectionMessage,
  type GameMap,
  type HeistSettings,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { InMemoryCollectionStore } from '../progress/CollectionStore';

const city = mapById('city') as GameMap;
const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(over: Partial<HeistSettings['collectibles']> = {}) {
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: {
      ...DEFAULT_HEIST_SETTINGS,
      collectibles: { ...DEFAULT_HEIST_SETTINGS.collectibles, ...over },
    },
    seed: 'chip-test',
  });
  const store = new InMemoryCollectionStore();
  match.heist.collectibles.bindStore(store);
  const join = (accountId?: number) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, 'P', connection, accountId);
    if (!r.ok) throw new Error('join failed');
    return { player: r.player, connection };
  };
  const last = (c: FakeConnection) =>
    c.jsonOf('collection').at(-1) as unknown as CollectionMessage | undefined;
  const tick = async () => {
    match.step();
    await settle();
    match.step();
  };
  return { match, store, join, last, tick, chips: () => match.heist.collectibles };
}

describe('collectible data chips (30.3)', () => {
  it('stand in the same places every time for one city, apart from each other', () => {
    const a = setup().chips().chips();
    const b = setup().chips().chips();
    expect(a).toHaveLength(DEFAULT_HEIST_SETTINGS.collectibles.count);
    expect(a.map((c) => [c.x, c.z])).toEqual(b.map((c) => [c.x, c.z]));
  });

  it('show their trivia and pay when picked up, once', async () => {
    const { match, join, last, tick, chips } = setup();
    const { player, connection } = join();
    await tick();
    const [chip] = chips().chips();
    if (!chip) throw new Error('no chip');
    match.teleport(player, chip.x, 0, chip.z);
    await tick();
    expect(player.cash).toBe(DEFAULT_HEIST_SETTINGS.collectibles.cash);
    const m = last(connection);
    expect(m?.latest).toBe(chip.id);
    expect(m?.found).toHaveLength(1);
    expect(m?.found[0]?.fact.length).toBeGreaterThan(10);
    await tick();
    expect(player.cash).toBe(DEFAULT_HEIST_SETTINGS.collectibles.cash);
  });

  it('keep a signed-in student’s finds across matches, but not a guest’s', async () => {
    const one = setup();
    const a = one.join(7);
    await one.tick();
    const chip = one.chips().chips()[0];
    if (!chip) throw new Error('no chip');
    one.match.teleport(a.player, chip.x, 0, chip.z);
    await one.tick();
    await settle();
    expect((await one.store.found(7)).size).toBe(1);
    // A fresh match, the same store and the same account: the chip is already theirs.
    const two = setup();
    await two.store.add(7, [...(await one.store.found(7))][0] as string);
    two.match.heist.collectibles.bindStore(two.store);
    const b = two.join(7);
    await two.tick();
    expect(two.chips().foundBy(b.player).size).toBe(1);
    const guest = two.join();
    await two.tick();
    expect(two.chips().foundBy(guest.player).size).toBe(0);
  });

  it('only tell a player about chips near them that they have not found', async () => {
    const { match, join, last, tick, chips } = setup({ revealRange: 35 });
    const { player, connection } = join();
    const [chip] = chips().chips();
    if (!chip) throw new Error('no chip');
    match.teleport(player, chip.x + 20, 0, chip.z);
    await tick();
    expect(last(connection)?.near.map((c) => c.id)).toContain(chip.id);
    match.teleport(player, chip.x + 150, 0, chip.z);
    await tick();
    expect(last(connection)?.near.map((c) => c.id) ?? []).not.toContain(chip.id);
  });

  it('are off when switched off', () => {
    expect(setup({ enabled: false }).chips().chips()).toHaveLength(0);
  });
});
