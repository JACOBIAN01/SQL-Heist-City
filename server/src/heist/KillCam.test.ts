import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  mapById,
  type GameMap,
  type KillCamMessage,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

const city = mapById('city') as GameMap;

function setup() {
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: DEFAULT_HEIST_SETTINGS,
    seed: 'killcam',
  });
  const join = (name: string) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, name, connection);
    if (!r.ok) throw new Error('join failed');
    return { player: r.player, connection };
  };
  for (let i = 0; i < 20 * match.tickRate; i++) match.step();
  const cam = (c: FakeConnection) =>
    c.jsonOf('killcam').at(-1) as unknown as KillCamMessage | undefined;
  return { match, join, heist: match.heist, cam };
}

describe('the kill-cam (35.1)', () => {
  it('tells a player who put them down, with how long that player’s last answer took', () => {
    const { match, join, heist, cam } = setup();
    const ana = join('Ana');
    const ben = join('Ben');
    heist.events.publish({
      type: 'task_solved',
      player: ben.player,
      rewardKey: 'vault:bank-1:lock-1',
      seconds: 41.6,
    });
    match.damage(ana.player, 999, ben.player);
    expect(cam(ana.connection)).toMatchObject({
      killer: { name: 'Ben' },
      seconds: 3.5,
      lastAnswer: { seconds: 42, rewardKey: 'vault:bank-1:lock-1' },
    });
    expect(cam(ben.connection)).toBeUndefined();
  });

  it('says only who it was when the killer has not answered anything', () => {
    const { match, join, cam } = setup();
    const ana = join('Ana');
    const ben = join('Ben');
    match.damage(ana.player, 999, ben.player);
    expect(cam(ana.connection)?.killer.name).toBe('Ben');
    expect(cam(ana.connection)?.lastAnswer).toBeUndefined();
  });

  it('quotes their latest answer, and forgets answers that are long past', () => {
    const { match, join, heist, cam } = setup();
    const ana = join('Ana');
    const ben = join('Ben');
    const carl = join('Carl');
    heist.events.publish({
      type: 'task_solved',
      player: ben.player,
      rewardKey: 'heal:small',
      seconds: 90,
    });
    heist.events.publish({
      type: 'task_solved',
      player: ben.player,
      rewardKey: 'gun:smg',
      seconds: 12,
    });
    match.damage(ana.player, 999, ben.player);
    expect(cam(ana.connection)?.lastAnswer).toMatchObject({ seconds: 12, rewardKey: 'gun:smg' });
    for (let i = 0; i < 650 * match.tickRate; i++) match.step();
    match.damage(carl.player, 999, ben.player);
    expect(cam(carl.connection)?.lastAnswer).toBeUndefined();
  }, 30_000);

  it('sends nothing for a death by your own hand', () => {
    const { match, join, cam } = setup();
    const ana = join('Ana');
    match.damage(ana.player, 999, ana.player);
    expect(cam(ana.connection)).toBeUndefined();
  });
});
