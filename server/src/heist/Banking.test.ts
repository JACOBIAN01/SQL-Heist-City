import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

const HOUSE = HEIST_MAP.anchors?.find((a) => a.id === 'safehouse-1') as { x: number; z: number };

function setup(bankingSeconds = 4) {
  const match = new Match({
    map: HEIST_MAP,
    settings: DEFAULT_MATCH_SETTINGS,
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: { ...DEFAULT_HEIST_SETTINGS, bankingSeconds },
  });
  const join = (name: string, at = { x: HOUSE.x, y: 0, z: HOUSE.z }, cash = 25_000) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, name, connection);
    if (!r.ok) throw new Error('join failed');
    Object.assign(r.player.body, at);
    match.heist.setCash(r.player, cash);
    let ref = 0;
    const use = () => {
      connection.clear();
      match.receiveJson(
        r.player.id,
        JSON.stringify({ t: 'interact', ref: ++ref, anchor: 'safehouse-1' }),
      );
      return connection.jsonOf('interact_result')[0]?.result;
    };
    return { player: r.player, connection, use };
  };
  const wait = (seconds: number) => {
    for (let i = 0; i < seconds * 20; i++) match.step();
  };
  return { match, join, wait };
}

describe('banking at a safehouse', () => {
  it('banks what you carry after standing there unhurt for the configured time', () => {
    const { join, wait } = setup();
    const a = join('A');
    expect(a.use()).toEqual({ action: 'banking', seconds: 4 });
    wait(3);
    expect(a.player.cash).toBe(25_000); // not yet
    wait(1.5);
    expect(a.player.cash).toBe(0);
    expect(a.player.banked).toBe(25_000);
    expect(a.connection.jsonOf('banking').at(-1)).toEqual({
      t: 'banking',
      status: 'done',
      amount: 25_000,
    });
    expect(a.connection.jsonOf('purse').at(-1)).toMatchObject({ carried: 0, banked: 25_000 });
  });

  it('restores full speed once the cash is banked', () => {
    const { join, wait } = setup(1);
    const a = join('A');
    a.use();
    wait(1.5);
    expect(a.player.speedScale).toBe(1);
    expect(a.player.banked).toBe(25_000);
  });

  it('is broken by damage, keeping the cash', () => {
    const { match, join, wait } = setup();
    const a = join('A');
    const b = join('B', { x: HOUSE.x + 10, y: 0, z: HOUSE.z }, 0);
    a.use();
    wait(2);
    match.damage(a.player, 10, b.player);
    expect(a.connection.jsonOf('banking').at(-1)).toEqual({
      t: 'banking',
      status: 'cancelled',
      reason: 'hurt',
    });
    wait(4);
    expect(a.player.cash).toBe(25_000);
    expect(a.player.banked).toBe(0);
  });

  it('is broken by walking away', () => {
    const { join, wait } = setup();
    const a = join('A');
    a.use();
    wait(1);
    a.player.body.x += 20;
    wait(0.2);
    expect(a.connection.jsonOf('banking').at(-1)).toMatchObject({
      status: 'cancelled',
      reason: 'moved',
    });
    wait(5);
    expect(a.player.banked).toBe(0);
  });

  it('is broken by dying, and the cash drops instead of banking', () => {
    const { match, join, wait } = setup();
    const a = join('A');
    const b = join('B', { x: HOUSE.x + 10, y: 0, z: HOUSE.z }, 0);
    a.use();
    wait(1);
    match.damage(a.player, 500, b.player);
    expect(a.player.cash).toBe(0);
    expect(a.player.banked).toBe(0);
    expect(a.connection.jsonOf('banking').filter((m) => m.status === 'cancelled')).toHaveLength(1);
    wait(5);
    expect(a.player.banked).toBe(0);
  });

  it('has nothing to bank with empty pockets', () => {
    const { join } = setup();
    expect(join('A', undefined, 0).use()).toEqual({ action: 'denied', reason: 'nothing_to_bank' });
  });

  it('must be done at the safehouse', () => {
    const { join } = setup();
    expect(join('A', { x: 0, y: 0, z: 0 }).use()).toEqual({ action: 'denied', reason: 'too_far' });
  });

  it('cannot be started twice at once', () => {
    const { join, wait } = setup();
    const a = join('A');
    a.use();
    wait(1);
    expect(a.use()).toEqual({ action: 'denied', reason: 'cooldown' });
  });

  it('honours a retuned banking time', () => {
    const { join, wait } = setup(1);
    const a = join('A');
    expect(a.use()).toEqual({ action: 'banking', seconds: 1 });
    wait(1.5);
    expect(a.player.banked).toBe(25_000);
  });

  it('drops the cash if the player disconnects mid-banking', () => {
    const { match, join, wait } = setup();
    const a = join('A');
    const b = join('B', { x: -40, y: 0, z: 40 }, 0);
    a.use();
    wait(1);
    b.connection.clear();
    match.leave(a.player.id);
    wait(5);
    expect(b.connection.jsonOf('loot')[0]?.add[0]?.amount).toBe(25_000);
    expect(match.heist.banking.isBanking(a.player)).toBe(false);
  });
});

describe('safehouses on the heist map', () => {
  it('has three, in reach of open ground', () => {
    const houses = HEIST_MAP.anchors?.filter((a) => a.kind === 'safehouse') ?? [];
    expect(houses).toHaveLength(3);
    for (const h of houses) {
      expect(
        HEIST_MAP.boxes.some((b) => h.x > b.minX && h.x < b.maxX && h.z > b.minZ && h.z < b.maxZ),
      ).toBe(false);
    }
  });
});
