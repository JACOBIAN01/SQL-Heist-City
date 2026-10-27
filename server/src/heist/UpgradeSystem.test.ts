import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  mapById,
  type GameMap,
  type ShopMessage,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { InMemoryUpgradeStore } from '../progress/UpgradeStore';

const city = mapById('city') as GameMap;
const settle = () => new Promise((r) => setTimeout(r, 0));
const PRICES = DEFAULT_HEIST_SETTINGS.upgrades;

async function setup(accountId?: number, store = new InMemoryUpgradeStore()) {
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: DEFAULT_HEIST_SETTINGS,
    seed: 'upgrade-test',
  });
  match.heist.upgrades.bindStore(store);
  const connection = new FakeConnection();
  const r = match.join(PROTOCOL_VERSION, 'P', connection, accountId);
  if (!r.ok) throw new Error('join failed');
  const player = r.player;
  const counter = city.anchors?.find((a) => a.kind === 'shop');
  if (!counter) throw new Error('no shop');
  match.teleport(player, counter.x, 0, counter.z);
  await settle();
  const last = () => connection.jsonOf('shop').at(-1) as unknown as ShopMessage;
  return { match, player, heist: match.heist, store, last, counter };
}

describe('safehouse upgrades (30.4)', () => {
  it('cost banked cash, not carried cash, and raise the level', async () => {
    const { player, heist, last } = await setup();
    player.banked = 10_000;
    player.cash = 500;
    heist.upgrades.buy(player, 'banking');
    expect(last().upgradeResult).toEqual({ upgrade: 'banking', ok: true });
    expect(player.banked).toBe(10_000 - (PRICES.banking.prices[0] as number));
    expect(player.cash).toBe(500);
    expect(last().upgrades.find((u) => u.id === 'banking')?.level).toBe(1);
  });

  it('refuse without the banked cash, away from a counter, and past the top level', async () => {
    const { match, player, heist, last, counter } = await setup();
    heist.upgrades.buy(player, 'armour');
    expect(last().upgradeResult).toMatchObject({ ok: false, reason: 'no_cash' });
    player.banked = 1_000_000;
    match.teleport(player, counter.x + 80, 0, counter.z + 80);
    heist.upgrades.buy(player, 'armour');
    expect(last().upgradeResult).toMatchObject({ reason: 'too_far' });
    match.teleport(player, counter.x, 0, counter.z);
    for (let i = 0; i < PRICES.stash.prices.length; i++) heist.upgrades.buy(player, 'stash');
    heist.upgrades.buy(player, 'stash');
    expect(last().upgradeResult).toMatchObject({ ok: false, reason: 'max' });
  });

  it('shorten banking', async () => {
    const { player, heist } = await setup();
    expect(heist.upgrades.bankingScale(player)).toBe(1);
    player.banked = 100_000;
    heist.upgrades.buy(player, 'banking');
    expect(heist.upgrades.bankingScale(player)).toBeCloseTo(1 - PRICES.banking.perLevel);
  });

  it('give spawn armour now and after every respawn', async () => {
    const { match, player, heist } = await setup();
    player.banked = 100_000;
    heist.upgrades.buy(player, 'armour');
    expect(player.armour).toBe(PRICES.armour.perLevel);
    player.armour = 0;
    match.damage(player, 999, player);
    for (let i = 0; i < 30 * match.tickRate && !player.alive; i++) match.step();
    expect(player.alive).toBe(true);
    expect(player.armour).toBe(PRICES.armour.perLevel);
  });

  it('let a player keep a share of carried cash on death', async () => {
    const { match, player, heist } = await setup();
    player.banked = 100_000;
    heist.upgrades.buy(player, 'stash');
    heist.upgrades.buy(player, 'stash');
    heist.setCash(player, 10_000);
    const foe = match.join(PROTOCOL_VERSION, 'F', new FakeConnection());
    if (!foe.ok) throw new Error('join failed');
    match.damage(player, 999, foe.player);
    expect(player.cash).toBe(Math.floor(10_000 * 2 * PRICES.stash.perLevel));
  });

  it('are kept for a signed-in student across matches, and not for a guest', async () => {
    const store = new InMemoryUpgradeStore();
    const one = await setup(5, store);
    one.player.banked = 100_000;
    one.heist.upgrades.buy(one.player, 'intel');
    await settle();
    expect(await store.levels(5)).toEqual({ intel: 1 });
    const two = await setup(5, store);
    await settle();
    expect(two.heist.upgrades.level(two.player, 'intel')).toBe(1);
    expect(two.heist.upgrades.intelRange(two.player)).toBe(PRICES.intel.perLevel);
    const guest = await setup(undefined, store);
    expect(guest.heist.upgrades.level(guest.player, 'intel')).toBe(0);
  });
});
