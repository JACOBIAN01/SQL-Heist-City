import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  mapById,
  type GameMap,
  type HeistSettings,
  type ShopMessage,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

const city = mapById('city') as GameMap;

function setup(shop: Partial<HeistSettings['shop']> = {}) {
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: { ...DEFAULT_HEIST_SETTINGS, shop: { ...DEFAULT_HEIST_SETTINGS.shop, ...shop } },
    seed: 'shop-test',
  });
  const counter = city.anchors?.find((a) => a.kind === 'shop');
  if (!counter) throw new Error('no shop in the city');
  const connection = new FakeConnection();
  const r = match.join(PROTOCOL_VERSION, 'P', connection);
  if (!r.ok) throw new Error('join failed');
  const player = r.player;
  const at = (x: number, z: number) => match.teleport(player, x, 0, z);
  at(counter.x, counter.z);
  const heist = match.heist;
  const last = () => connection.jsonOf('shop').at(-1) as unknown as ShopMessage;
  const give = (cash: number) => heist.setCash(player, cash);
  return { match, player, counter, at, last, give, heist };
}

describe('street shops (29.6)', () => {
  it('stand beside every safehouse', () => {
    const shops = city.anchors?.filter((a) => a.kind === 'shop') ?? [];
    const houses = city.anchors?.filter((a) => a.kind === 'safehouse') ?? [];
    expect(houses.length).toBeGreaterThan(0);
    expect(shops).toHaveLength(houses.length);
  });

  it('open their window on F at the counter', () => {
    const { heist, player, counter, last } = setup();
    expect(heist.interactions.use(player, counter.id)).toEqual({ action: 'open_shop' });
    expect(last().offers.map((o) => o.item)).toEqual(['armour', 'ammo']);
  });

  it('sell armour for carried cash, never more than the most there can be', () => {
    const { heist, player, give, last } = setup();
    give(10_000);
    heist.shop.buy(player, 'armour');
    expect(last().result).toEqual({ item: 'armour', ok: true });
    expect(player.armour).toBe(50);
    expect(player.cash).toBe(10_000 - DEFAULT_HEIST_SETTINGS.shop.armourPrice);
    heist.shop.buy(player, 'armour');
    expect(player.armour).toBe(100);
    heist.shop.buy(player, 'armour');
    expect(last().result).toMatchObject({ ok: false, reason: 'full' });
    expect(player.cash).toBe(10_000 - 2 * DEFAULT_HEIST_SETTINGS.shop.armourPrice);
  });

  it('refuse when the cash is short, without taking any', () => {
    const { heist, player, give, last } = setup();
    give(100);
    heist.shop.buy(player, 'armour');
    expect(last().result).toMatchObject({ ok: false, reason: 'no_cash' });
    expect(player.cash).toBe(100);
    expect(player.armour).toBe(0);
  });

  it('refuse away from a counter, when dead, or when switched off', () => {
    const { heist, player, give, last, at, counter } = setup();
    give(10_000);
    at(counter.x + 60, counter.z + 60);
    heist.shop.buy(player, 'armour');
    expect(last().result).toMatchObject({ reason: 'too_far' });
    at(counter.x, counter.z);
    player.alive = false;
    heist.shop.buy(player, 'armour');
    expect(last().result).toMatchObject({ reason: 'dead' });
    expect(player.cash).toBe(10_000);
    const off = setup({ enabled: false });
    off.give(10_000);
    off.heist.shop.buy(off.player, 'armour');
    expect(off.last().result).toMatchObject({ reason: 'closed' });
  });

  it('reload the held gun, but only when it is short of rounds', () => {
    const { match, heist, player, give, last } = setup();
    give(5_000);
    heist.giveWeapon(player, 'pistol');
    heist.shop.buy(player, 'ammo');
    expect(last().result).toMatchObject({ ok: false, reason: 'full' });
    const mag = match.weaponSpec('pistol')?.magSize ?? 0;
    player.arsenal.set('pistol', 1);
    heist.shop.buy(player, 'ammo');
    expect(player.ammo).toBe(mag);
    expect(player.cash).toBe(5_000 - DEFAULT_HEIST_SETTINGS.shop.ammoPrice);
  });

  it('give armour that soaks damage before health, and is lost on death', () => {
    const { match, player, give, heist } = setup();
    give(10_000);
    heist.shop.buy(player, 'armour');
    const foe = match.join(PROTOCOL_VERSION, 'F', new FakeConnection());
    if (!foe.ok) throw new Error('join failed');
    match.damage(player, 30, foe.player);
    expect(player.armour).toBe(20);
    expect(player.hp).toBe(DEFAULT_COMBAT_SETTINGS.maxHp);
    match.damage(player, 30, foe.player);
    expect(player.armour).toBe(0);
    expect(player.hp).toBe(DEFAULT_COMBAT_SETTINGS.maxHp - 10);
  });
});
