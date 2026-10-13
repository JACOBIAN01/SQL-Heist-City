import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ATMOSPHERE_SETTINGS,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  DEFAULT_REWARD_ICONS,
  DEFAULT_VEHICLE_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
  type WorldSettings,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

const quick = {
  ...DEFAULT_HEIST_SETTINGS,
  roundMinutes: 0.1,
  overtimeSeconds: 1,
  intermissionSeconds: 1,
  scoreboardEverySec: 1,
};

/** A match whose settings an "admin" can change between rounds. */
function setup() {
  let world: WorldSettings = {
    heist: quick,
    vehicles: DEFAULT_VEHICLE_SETTINGS,
    atmosphere: DEFAULT_ATMOSPHERE_SETTINGS,
    rewardIcons: DEFAULT_REWARD_ICONS,
  };
  const match = new Match({
    map: HEIST_MAP,
    settings: DEFAULT_MATCH_SETTINGS,
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: world.heist,
    worldSource: () => world,
  });
  const connection = new FakeConnection();
  const joined = match.join(PROTOCOL_VERSION, 'Ana', connection);
  if (!joined.ok) throw new Error('join failed');
  const wait = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 20); i++) match.step();
  };
  return {
    match,
    connection,
    wait,
    set: (next: Partial<WorldSettings>) => (world = { ...world, ...next }),
  };
}

describe('admin edits reach a running match at the next round (12.4)', () => {
  it('tells a new player the car and sky numbers', () => {
    const { connection } = setup();
    expect(connection.jsonOf('world').at(-1)).toMatchObject({
      vehicles: DEFAULT_VEHICLE_SETTINGS,
      atmosphere: DEFAULT_ATMOSPHERE_SETTINGS,
    });
  });

  it('applies heist numbers, car numbers and the sky when the next round starts, and not before', () => {
    const { match, connection, wait, set } = setup();
    const sedan = DEFAULT_VEHICLE_SETTINGS.kinds.sedan;
    set({
      heist: { ...quick, locksPerVault: 5, bankingSeconds: 9, killBonus: 123 },
      vehicles: {
        ...DEFAULT_VEHICLE_SETTINGS,
        kinds: { ...DEFAULT_VEHICLE_SETTINGS.kinds, sedan: { ...sedan, maxSpeed: 33 } },
      },
      atmosphere: { ...DEFAULT_ATMOSPHERE_SETTINGS, dayMinutes: 10 },
    });
    expect(match.heist.settings.killBonus).toBe(quick.killBonus); // mid-round: nothing moves
    const before = connection.jsonOf('world').length;
    wait(10); // round (6 s) + overtime/intermission → a new round
    expect(match.heist.settings).toMatchObject({
      locksPerVault: 5,
      bankingSeconds: 9,
      killBonus: 123,
    });
    expect([...match.heist.vaults.all()].every((v) => v.lockCount === 5)).toBe(true);
    const world = connection.jsonOf('world');
    expect(world.length).toBeGreaterThan(before);
    expect(world.at(-1)).toMatchObject({ atmosphere: { dayMinutes: 10 } });
    expect(world.at(-1)?.vehicles.kinds.sedan.maxSpeed).toBe(33);
  });

  it('sends the reward icons the admin picked', () => {
    const { connection, wait, set } = setup();
    set({ rewardIcons: { ...DEFAULT_REWARD_ICONS, 'gun:smg': 'rifle' } });
    wait(10);
    expect(connection.jsonOf('world').at(-1)?.rewardIcons['gun:smg']).toBe('rifle');
  });

  it('never rewrites the shared defaults', () => {
    const { wait, set } = setup();
    set({ heist: { ...quick, killBonus: 777 } });
    wait(10);
    expect(DEFAULT_HEIST_SETTINGS.killBonus).not.toBe(777);
  });
});
