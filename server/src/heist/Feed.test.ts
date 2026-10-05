import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
  type FeedItem,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

function setup(heist = DEFAULT_HEIST_SETTINGS) {
  const match = new Match({
    map: HEIST_MAP,
    settings: DEFAULT_MATCH_SETTINGS,
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist,
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

const feed = (c: FakeConnection): FeedItem[] => c.jsonOf('feed').map((m) => m.item);

describe('event feed', () => {
  it('raises the alarm for each lock cracked, then announces the vault open, to everyone', () => {
    const { match, join } = setup();
    const far = join('Far', { x: -50, y: 0, z: -50 });
    match.heist.openLock('bank-1:vault', 1);
    match.heist.openLock('bank-1:vault', 2);
    match.heist.openLock('bank-1:vault', 2); // a second solver of the same lock: no news
    match.heist.openLock('bank-1:vault', 3);
    expect(feed(far.connection)).toEqual([
      { kind: 'alarm', bank: 'Corner Savings', tier: 1, lock: 1, locks: 3 },
      { kind: 'alarm', bank: 'Corner Savings', tier: 1, lock: 2, locks: 3 },
      { kind: 'vault_open', bank: 'Corner Savings', tier: 1 },
    ]);
  });

  it('tells everyone who banked how much', () => {
    const { match, join } = setup();
    const pad = HEIST_MAP.anchors?.find((x) => x.id === 'safehouse-1');
    if (!pad) throw new Error('no safehouse');
    const a = join('Ana', { x: pad.x, y: 0, z: pad.z });
    const b = join('Ben', { x: -50, y: 0, z: -50 });
    match.heist.setCash(a.player, 30_000);
    match.heist.banking.start(a.player, pad);
    for (let i = 0; i < DEFAULT_HEIST_SETTINGS.bankingSeconds * 20 + 2; i++) match.step();
    expect(feed(b.connection)).toContainEqual({
      kind: 'banked',
      id: a.player.id,
      name: 'Ana',
      amount: 30_000,
    });
  });
});

describe('bounties', () => {
  const rich = DEFAULT_HEIST_SETTINGS.bountyThreshold;

  it('puts a price on whoever carries a fortune, and shows everyone where they are', () => {
    const { match, join } = setup();
    const a = join('Ana', { x: 12, y: 0, z: 34 });
    const b = join('Ben', { x: -50, y: 0, z: -50 });
    match.heist.setCash(a.player, rich);
    match.step();
    expect(feed(b.connection)).toContainEqual({
      kind: 'wanted',
      id: a.player.id,
      name: 'Ana',
      cash: rich,
      reward: DEFAULT_HEIST_SETTINGS.bountyReward,
    });
    const board = b.connection.jsonOf('bounties').at(-1);
    expect(board?.wanted).toEqual([{ id: a.player.id, name: 'Ana', x: 12, z: 34, cash: rich }]);
  });

  it('posts the board every few seconds, and clears it once when nobody is wanted', () => {
    const { match, join } = setup();
    const a = join('Ana');
    const b = join('Ben', { x: -50, y: 0, z: -50 });
    match.step();
    expect(b.connection.jsonOf('bounties')).toHaveLength(0); // nobody wanted, nothing sent
    match.heist.setCash(a.player, rich);
    for (let i = 0; i < DEFAULT_HEIST_SETTINGS.bountyEverySec * 20 * 2 + 1; i++) match.step();
    expect(b.connection.jsonOf('bounties').length).toBeGreaterThanOrEqual(2);
    match.heist.setCash(a.player, 0);
    for (let i = 0; i < DEFAULT_HEIST_SETTINGS.bountyEverySec * 20 * 3; i++) match.step();
    const posts = b.connection.jsonOf('bounties');
    expect(posts.at(-1)?.wanted).toEqual([]);
    expect(posts.filter((p) => p.wanted.length === 0)).toHaveLength(1);
  });

  it('pays the killer of a wanted player the bounty on top of the kill bonus, and says so', () => {
    const { match, join } = setup();
    const a = join('Ana');
    const b = join('Ben', { x: -50, y: 0, z: -50 });
    match.heist.setCash(a.player, rich);
    match.step();
    match.damage(a.player, 500, b.player);
    expect(b.player.cash).toBe(
      DEFAULT_HEIST_SETTINGS.killBonus + DEFAULT_HEIST_SETTINGS.bountyReward,
    );
    expect(feed(b.connection)).toContainEqual({
      kind: 'bounty_claimed',
      killerId: b.player.id,
      killer: 'Ben',
      victimId: a.player.id,
      victim: 'Ana',
      reward: DEFAULT_HEIST_SETTINGS.bountyReward,
    });
    expect(match.heist.bounties.isWanted(a.player)).toBe(false);
  });

  it('pays nothing extra for killing someone not wanted', () => {
    const { match, join } = setup();
    const a = join('Ana');
    const b = join('Ben', { x: -50, y: 0, z: -50 });
    match.heist.setCash(a.player, rich - 1);
    match.step();
    match.damage(a.player, 500, b.player);
    expect(b.player.cash).toBe(DEFAULT_HEIST_SETTINGS.killBonus);
  });

  it('shows a player who joins the current board', () => {
    const { match, join } = setup();
    const a = join('Ana');
    match.heist.setCash(a.player, rich);
    match.step();
    const late = join('Late', { x: -50, y: 0, z: -50 });
    expect(late.connection.jsonOf('bounties')[0]?.wanted[0]?.name).toBe('Ana');
  });
});
