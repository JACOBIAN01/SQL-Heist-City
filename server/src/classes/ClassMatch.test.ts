import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  DEFAULT_VEHICLE_SETTINGS,
  DEFAULT_ATMOSPHERE_SETTINGS,
  DEFAULT_REWARD_ICONS,
  HEIST_MAP,
  mapById,
  type GameMap,
  PROTOCOL_VERSION,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { ScriptedGateway } from '../heist/testing';
import {
  classMatchConfig,
  classTaskOptions,
  closedTiers,
  type ClassMatchConfig,
} from './ClassMatchConfig';
import { classInputSchema, usageOfReward, type ClassRecord } from '@heist/shared';

const record: ClassRecord = {
  ...classInputSchema.parse({ name: '9B', banksOpen: [1], roundMinutes: 7, playerCap: 60 }),
  id: 1,
  code: 'ABCDEF',
  ownerUserId: null,
  locked: false,
  archived: false,
  createdAt: '',
  updatedAt: '',
};
const config = (over: Partial<ClassMatchConfig> = {}): ClassMatchConfig => ({
  ...classMatchConfig(record, [
    { questionId: 10, usage: 'vault' },
    { questionId: 11, usage: 'heal' },
    { questionId: 12, usage: 'heal' },
  ]),
  ...over,
});

describe('class match config', () => {
  it('groups released questions by what they are for', () => {
    expect(config().questions).toEqual({ vault: [10], heal: [11, 12], gun: [], ammo: [] });
    expect(usageOfReward('vault:bank-1:lock-2')).toBe('vault');
    expect(usageOfReward('ammo:refill')).toBe('ammo');
    expect(usageOfReward('mystery:x')).toBeUndefined();
  });

  it('asks for a task only from the questions released for its kind, and for nothing unknown', () => {
    const options = classTaskOptions(config());
    expect([...(options('heal:small').allowedQuestions ?? [])]).toEqual([11, 12]);
    expect([...(options('vault:bank-1:lock-1').allowedQuestions ?? [])]).toEqual([10]);
    expect(options('gun:rifle').allowedQuestions?.size).toBe(0);
    expect(options('mystery:x').allowedQuestions?.size).toBe(0);
  });

  it("passes the class's dialect along, and lets planning briefs draw from every brief", () => {
    const options = classTaskOptions(config({ dialect: 'postgres' }));
    expect(options('heal:small').dialect).toBe('postgres');
    expect(options('brief:plan')).toEqual({ dialect: 'postgres' });
  });

  it('works out which banks are closed', () => {
    expect([...closedTiers([1, 3])].sort()).toEqual([2, 4, 5]);
    expect(closedTiers([1, 2, 3, 4, 5]).size).toBe(0);
  });
});

function setup(cfg: ClassMatchConfig, gateway = new ScriptedGateway(), map: GameMap = HEIST_MAP) {
  let world = {
    heist: { ...DEFAULT_HEIST_SETTINGS, roundMinutes: 15 },
    vehicles: DEFAULT_VEHICLE_SETTINGS,
    atmosphere: DEFAULT_ATMOSPHERE_SETTINGS,
    rewardIcons: DEFAULT_REWARD_ICONS,
  };
  const match = new Match({
    map,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 200 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: world.heist,
    worldSource: () => world,
    challenges: gateway,
    classConfig: cfg,
  });
  const join = () => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, 'P', connection);
    return { r, connection };
  };
  return {
    match,
    gateway,
    join,
    setWorld: (heist: Partial<typeof world.heist>) =>
      (world = { ...world, heist: { ...world.heist, ...heist } }),
  };
}

describe('a match for a class', () => {
  it('hands the challenge system the class’s question set with every task', async () => {
    const { match, gateway, join } = setup(config());
    const { r } = join();
    if (!r.ok) throw new Error('join');
    r.player.hp = 40; // a heal is refused at full health
    match.receiveJson(
      r.player.id,
      JSON.stringify({ t: 'challenge_request', ref: 1, rewardKey: 'heal:small' }),
    );
    await new Promise((res) => setImmediate(res));
    expect([...(gateway.calls[0]?.options?.allowedQuestions ?? [])]).toEqual([11, 12]);
  });

  it('refuses players beyond the class cap', () => {
    const { join } = setup(config({ playerCap: 2 }));
    expect(join().r.ok).toBe(true);
    expect(join().r.ok).toBe(true);
    expect(join().r).toMatchObject({ ok: false, reason: 'Match is full' });
  });

  it('closes the banks the teacher did not open: marked closed, no lock work, no loose cash', () => {
    const { match, join } = setup(
      config({ banksOpen: [1] }),
      undefined,
      mapById('city') as GameMap,
    );
    const { connection } = join();
    const vaults = connection.jsonOf('vaults').at(-1)?.vaults ?? [];
    expect(vaults.length).toBeGreaterThan(1);
    for (const v of vaults) expect(v.closed === true, `tier ${v.tier}`).toBe(v.tier !== 1);
    const piles = connection.jsonOf('loot').flatMap((m) => m.add);
    expect(piles.length).toBe(match.map.cashSpots?.filter((c) => c.tier === 1).length ?? 0);
  });

  it('applies the class round length over the admin setting, at every new round', async () => {
    const { match, setWorld } = setup(config({ roundMinutes: 7 }));
    expect(match.heist.settings.roundMinutes).toBe(7);
    setWorld({ roundMinutes: 20 });
    match.refreshWorld();
    expect(match.heist.settings.roundMinutes).toBe(7);
  });

  it('takes a teacher’s edit while running: new questions at once, new banks open at once', async () => {
    const { match, gateway, join } = setup(config({ banksOpen: [1] }));
    const { r, connection } = join();
    if (!r.ok) throw new Error('join');
    r.player.hp = 40;
    match.applyClassConfig(
      config({
        banksOpen: [1, 2, 3, 4, 5],
        questions: { vault: [], heal: [99], gun: [], ammo: [] },
      }),
    );
    expect(
      connection
        .jsonOf('vaults')
        .at(-1)
        ?.vaults.some((v) => v.closed),
    ).toBe(false);
    match.receiveJson(
      r.player.id,
      JSON.stringify({ t: 'challenge_request', ref: 1, rewardKey: 'heal:small' }),
    );
    await new Promise((res) => setImmediate(res));
    expect([...(gateway.calls[0]?.options?.allowedQuestions ?? [])]).toEqual([99]);
  });
});
