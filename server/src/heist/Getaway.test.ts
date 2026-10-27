import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  mapById,
  type GameMap,
  type RoadblocksMessage,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

const city = mapById('city') as GameMap;
const vault = city.vaults?.[0];
if (!vault) throw new Error('no vault');
const lootSpot = vault.loot[0];
if (!lootSpot) throw new Error('no loot');
const spot = lootSpot;
const bank = vault.bank;

/** A player on the getaway from the first bank, standing on a street, with `intel` points on it. */
function setup(intel: number, perStar = 0) {
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: {
      ...DEFAULT_HEIST_SETTINGS,
      caches: { ...DEFAULT_HEIST_SETTINGS.caches, enabled: false },
      collectibles: { ...DEFAULT_HEIST_SETTINGS.collectibles, enabled: false },
      guards: { ...DEFAULT_HEIST_SETTINGS.guards, perBankTier: {} },
      police: { ...DEFAULT_HEIST_SETTINGS.police, perStar },
    },
    seed: 'getaway-test',
  });
  const connection = new FakeConnection();
  const r = match.join(PROTOCOL_VERSION, 'P', connection);
  if (!r.ok) throw new Error('join failed');
  const player = r.player;
  const street = match.map.spawns[0];
  if (!street) throw new Error('no spawn');
  match.teleport(player, street.x, 0, street.z);
  for (let i = 0; i < 20 * match.tickRate; i++) match.step();
  player.alive = true;
  player.hp = match.maxHp;
  match.teleport(player, street.x, 0, street.z);
  for (let i = 0; i < intel; i++) match.heist.acts.grantIntel(player, bank);
  // Take the vault's cash: the getaway begins.
  match.heist.events.publish({ type: 'bag_taken', player, amount: 5_000, x: spot.x, z: spot.z });
  const blocks = () =>
    connection.jsonOf('roadblocks').map((m) => m as unknown as RoadblocksMessage);
  const wanted = (n: number) => {
    for (let i = 0; i < n; i++) match.heist.police.crime(player, 'lock');
    for (let i = 0; i < 3 * match.tickRate; i++) match.step();
  };
  return { match, player, heist: match.heist, blocks, wanted, street };
}

describe('the getaway (31.3)', () => {
  it('has the police block the way to the nearest safehouse', () => {
    const { player, heist, wanted, street } = setup(0);
    expect(heist.acts.runOf(player)?.act).toBe('getaway');
    wanted(4);
    const block = heist.police.roadblockOf(player);
    if (!block) throw new Error('no roadblock');
    const houses = (city.anchors ?? []).filter((a) => a.kind === 'safehouse');
    const nearest = houses.reduce((a, b) =>
      Math.hypot(a.x - street.x, a.z - street.z) < Math.hypot(b.x - street.x, b.z - street.z)
        ? a
        : b,
    );
    // The block is on the player's side of the safehouse, towards it.
    const before = Math.hypot(nearest.x - street.x, nearest.z - street.z);
    const after = Math.hypot(nearest.x - block.x, nearest.z - block.z);
    expect(after).toBeLessThan(before);
  });

  it('shows the roadblock on your map only if your intel has told you', () => {
    const none = setup(0);
    none.wanted(4);
    expect(none.heist.police.roadblockOf(none.player)).toBeDefined();
    expect(none.blocks()).toHaveLength(0);
    const spy = setup(1);
    spy.wanted(4);
    const sent = spy.blocks().filter((m) => m.posts.length > 0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.posts[0]).toEqual(spy.heist.police.roadblockOf(spy.player));
  });

  it('takes the roadblock off your map when the wanted level goes', () => {
    const spy = setup(1);
    spy.wanted(4);
    spy.heist.police.clear(spy.player);
    expect(spy.blocks().at(-1)?.posts).toEqual([]);
  });

  it('is held by one officer instead of two with full intel', () => {
    const plain = setup(0);
    plain.wanted(4);
    const thin = setup(3);
    thin.wanted(4);
    expect(plain.heist.police.officers()).toHaveLength(2);
    expect(thin.heist.police.officers()).toHaveLength(1);
  });

  it('does not change a getaway that never began: the block is ahead of where you run', () => {
    const { match, player, heist, wanted } = setup(0);
    // End the heist run: no getaway, so the police only guess from the way you are moving.
    heist.acts.died(player);
    player.body.vx = 6;
    player.body.vz = 0;
    wanted(4);
    const block = heist.police.roadblockOf(player);
    expect(block).toBeDefined();
    expect((block?.x ?? 0) - player.body.x).toBeGreaterThan(0);
    void match;
  });
});
