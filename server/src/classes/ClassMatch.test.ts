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
import {
  DEFAULT_MODES_SETTINGS,
  classInputSchema,
  customHeistSpecSchema,
  customMode,
  modeById,
  usageOfReward,
  type ClassRecord,
} from '@heist/shared';

const record: ClassRecord = {
  ...classInputSchema.parse({ name: '9B', banksOpen: [1], roundMinutes: 7, playerCap: 60 }),
  id: 1,
  code: 'ABCDEF',
  ownerUserId: null,
  locked: false,
  archived: false,
  archivedAt: null,
  consent: null,
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

describe('a room in another game mode (28.1, 28.2, 28.4)', () => {
  const withMode = (id: string, over: Partial<ClassRecord> = {}) =>
    classMatchConfig(
      { ...record, banksOpen: [1, 2, 3], roundMinutes: null, ...over },
      [],
      {},
      modeById(DEFAULT_MODES_SETTINGS, id),
    );
  const roundSeconds = (cfg: ClassMatchConfig) => {
    const { join } = setup(cfg);
    const { connection } = join();
    return (connection.jsonOf('round').at(-1) as { endsInSec: number }).endsInSec;
  };

  it('classic changes nothing: every open bank, the game’s round length', () => {
    const cfg = withMode('classic');
    expect(cfg.banksOpen).toEqual([1, 2, 3]);
    expect(roundSeconds(cfg)).toBe(DEFAULT_HEIST_SETTINGS.roundMinutes * 60);
  });

  it('smash and grab is a five-minute round on one bank with two locks', () => {
    const cfg = withMode('smash-and-grab');
    expect(cfg.banksOpen).toEqual([1]);
    expect(roundSeconds(cfg)).toBe(5 * 60);
    const { match } = setup(cfg);
    expect(match.heist.settings.locksPerVault).toBe(2);
  });

  it('the teacher’s own round length wins over the mode’s', () => {
    expect(roundSeconds(withMode('smash-and-grab', { roundMinutes: 8 }))).toBe(8 * 60);
    expect(roundSeconds(withMode('classic', { roundMinutes: 8 }))).toBe(8 * 60);
  });

  it('is a mode of settings: one the admin made up works the same way', () => {
    const custom = {
      ...modeById(DEFAULT_MODES_SETTINGS, 'classic'),
      id: 'marathon',
      heist: { roundMinutes: 40 },
      bankLimit: 2,
    };
    const cfg = classMatchConfig(
      { ...record, banksOpen: [1, 2, 3, 4], roundMinutes: null },
      [],
      {},
      custom,
    );
    expect(cfg.banksOpen).toEqual([1, 2]);
    expect(roundSeconds(cfg)).toBe(40 * 60);
  });
});

describe('a teacher’s own heist (34.5)', () => {
  const spec = customHeistSpecSchema.parse({
    name: 'Library job',
    bank: 2,
    locks: ['select-all', 'where-basics', 'join-two'],
    story: { title: 'The library', lines: [{ speaker: 'Mae', text: 'Quietly now.' }] },
  });
  const customConfig = (): ClassMatchConfig =>
    classMatchConfig(record, [], {}, customMode(9, spec));

  it('asks its own question at each lock of its bank, the same for the whole class', () => {
    const ask = classTaskOptions(customConfig());
    expect(ask('vault:bank-2:lock-1')).toMatchObject({
      fixed: { slug: 'select-all', seed: 'custom-1-1' },
    });
    expect(ask('vault:bank-2:lock-3')).toMatchObject({ fixed: { slug: 'join-two' } });
  });

  it('leaves other banks, other rewards and locks past its chain to the ordinary rules', () => {
    const ask = classTaskOptions(customConfig());
    expect(ask('vault:bank-3:lock-1').fixed).toBeUndefined();
    expect(ask('vault:bank-2:lock-4').fixed).toBeUndefined();
    expect(ask('heal:small').fixed).toBeUndefined();
  });

  it('plays on one bank with as many locks as questions', () => {
    const c = customConfig();
    expect(c.mode.id).toBe('custom-9');
    expect(c.mode.heist).toMatchObject({ locksPerVault: 3 });
    expect(c.mode.bankLimit).toBe(1);
  });

  it('opens with the teacher’s story when a student joins', () => {
    const match = new Match({
      map: mapById('city') as GameMap,
      settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 60, sandboxDummies: 0 },
      combat: DEFAULT_COMBAT_SETTINGS,
      heist: DEFAULT_HEIST_SETTINGS,
      classConfig: customConfig(),
      seed: 'custom',
    });
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, 'P', connection);
    expect(r.ok).toBe(true);
    const scene = connection.jsonOf('scene').at(-1) as unknown as {
      title: string;
      lines: { speaker: string }[];
    };
    expect(scene.title).toBe('The library');
    expect(scene.lines[0]?.speaker).toBe('Mae');
  });
});
