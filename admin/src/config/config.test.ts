import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CHALLENGE_SETTINGS,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_VEHICLE_SETTINGS,
  type CombatSettings,
  type VehicleSettings,
  type RewardTierEntry,
} from '@heist/shared';
import { DEFAULT_TUTORIAL_SETTINGS } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { SqliteSettingsReader } from '@heist/server/config/SettingsReader';
import { startAdmin } from '../testing/harness';

type Harness = Awaited<ReturnType<typeof startAdmin>>;
let h: Harness | undefined;
afterEach(() => h?.close());

type Rewards = { rewards: RewardTierEntry[] };

describe('settings API', () => {
  it('reads defaults, merges partial updates, and the game reader sees them', async () => {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    expect((await h.client.get('/api/config/settings')).body).toEqual({
      challenges: { current: DEFAULT_CHALLENGE_SETTINGS, defaults: DEFAULT_CHALLENGE_SETTINGS },
    });
    const res = await h.client.put('/api/config/settings', { challenges: { lockoutSec: 30 } });
    expect(res.body).toEqual({ challenges: { ...DEFAULT_CHALLENGE_SETTINGS, lockoutSec: 30 } });
    expect(new SqliteSettingsReader(h.db).challengeSettings().lockoutSec).toBe(30);
  });

  it('rejects invalid values and non-admins', async () => {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    expect(
      (await h.client.put('/api/config/settings', { challenges: { lockoutSec: -5 } })).status,
    ).toBe(400);
    h.client.clearCookie();
    await h.loginAs('t@school.test', 'teacher');
    expect((await h.client.get('/api/config/settings')).status).toBe(200);
    expect(
      (await h.client.put('/api/config/settings', { challenges: { lockoutSec: 5 } })).status,
    ).toBe(403);
  });
});

describe('reward map API', () => {
  it('overrides tiers, resets to default, and the game reader sees it', async () => {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    const put = await h.client.put<Rewards>('/api/config/reward-map', {
      rewards: [{ key: 'gun:rifle', min: 2, max: 3 }],
    });
    expect(put.body.rewards.find((r) => r.key === 'gun:rifle')).toEqual({
      key: 'gun:rifle',
      min: 2,
      max: 3,
      isDefault: false,
    });
    expect(new SqliteSettingsReader(h.db).rewardTiers('gun:rifle')).toEqual({ min: 2, max: 3 });

    const reset = await h.client.put<Rewards>('/api/config/reward-map', {
      rewards: [{ key: 'gun:rifle', min: 4, max: 4 }],
    });
    expect(reset.body.rewards.find((r) => r.key === 'gun:rifle')?.isDefault).toBe(true);
  });

  it('rejects unknown rewards and inverted ranges', async () => {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    expect(
      (
        await h.client.put('/api/config/reward-map', {
          rewards: [{ key: 'gun:laser', min: 1, max: 1 }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.client.put('/api/config/reward-map', {
          rewards: [{ key: 'gun:rifle', min: 4, max: 2 }],
        })
      ).status,
    ).toBe(400);
  });

  it('records settings changes in the audit log', async () => {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    await h.client.put('/api/config/settings', { challenges: { ttlSec: 120 } });
    const audit = await h.client.get<{ entries: { entity: string; entityId: string }[] }>(
      '/api/audit?entity=settings',
    );
    expect(audit.body.entries[0]).toMatchObject({ entity: 'settings', entityId: 'challenges' });
  });
});

describe('combat (guns) API', () => {
  it('retunes one field of one gun, keeps the rest, and the game reader sees it', async () => {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    const before = (await h.client.get('/api/config/combat')).body as {
      combat: { current: CombatSettings; defaults: CombatSettings };
    };
    expect(before.combat.current).toEqual(DEFAULT_COMBAT_SETTINGS);
    const res = await h.client.put('/api/config/combat', {
      combat: { headshotMultiplier: 2.5, weapons: { smg: { damage: 14 } } },
    });
    expect(res.status).toBe(200);
    const game = new SqliteSettingsReader(h.db).combatSettings();
    expect(game.headshotMultiplier).toBe(2.5);
    expect(game.weapons.smg).toEqual({ ...DEFAULT_COMBAT_SETTINGS.weapons.smg, damage: 14 });
    expect(game.weapons.rifle).toEqual(DEFAULT_COMBAT_SETTINGS.weapons.rifle);
  });

  it('rejects unknown guns, impossible numbers and non-admins', async () => {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    const put = (combat: unknown) => h?.client.put('/api/config/combat', { combat });
    expect((await put({ weapons: { laser: { damage: 1 } } }))?.status).toBe(400);
    expect((await put({ weapons: { sniper: { aimZoom: 20 } } }))?.status).toBe(400);
    expect((await put({ weapons: { pistol: { magSize: 0 } } }))?.status).toBe(400);
    h.client.clearCookie();
    await h.loginAs('t@school.test', 'teacher');
    expect((await put({ maxHp: 200 }))?.status).toBe(403);
  });
});

describe('tutorial API', () => {
  async function withQuestions(slugs: readonly string[]) {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    for (const slug of slugs)
      expect((await h.client.post('/api/questions', { ...sampleQuestion, slug })).status).toBe(201);
    return h;
  }

  it('picks one fixed question, keeps the others, and the game reader sees it', async () => {
    const d = DEFAULT_TUTORIAL_SETTINGS.questions;
    const h = await withQuestions([d.heal, d.gun, d.vault, 'easy-one']);
    expect((await h.client.get('/api/config/tutorial')).body).toEqual({
      tutorial: { current: DEFAULT_TUTORIAL_SETTINGS, defaults: DEFAULT_TUTORIAL_SETTINGS },
    });
    const res = await h.client.put('/api/config/tutorial', {
      tutorial: { questions: { gun: 'easy-one' } },
    });
    expect(res.status).toBe(200);
    expect(new SqliteSettingsReader(h.db).tutorialSettings().questions).toEqual({
      ...d,
      gun: 'easy-one',
    });
  });

  it('rejects a question that does not exist, and non-admins', async () => {
    const d = DEFAULT_TUTORIAL_SETTINGS.questions;
    const h = await withQuestions([d.heal, d.gun, d.vault]);
    const put = (tutorial: unknown) => h.client.put('/api/config/tutorial', { tutorial });
    const res = await put({ questions: { heal: 'nope' } });
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('unknown_question');
    h.client.clearCookie();
    await h.loginAs('t@school.test', 'teacher');
    expect((await put({ seed: 'x' })).status).toBe(403);
  });
});

describe('heist, vehicle, atmosphere and city settings API (12.4)', () => {
  it('merges a nested change, keeps the rest, and the game reader sees it', async () => {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    const got = await h.client.get<{ vehicles: { current: unknown; defaults: unknown } }>(
      '/api/config/vehicles',
    );
    expect(got.body.vehicles.current).toEqual(DEFAULT_VEHICLE_SETTINGS);
    const res = await h.client.put<{ vehicles: VehicleSettings }>('/api/config/vehicles', {
      vehicles: { kinds: { sedan: { maxSpeed: 31 } }, runOver: { minSpeed: 8 } },
    });
    expect(res.body.vehicles.kinds.sedan.maxSpeed).toBe(31);
    expect(res.body.vehicles.kinds.sedan.accel).toBe(DEFAULT_VEHICLE_SETTINGS.kinds.sedan.accel);
    expect(res.body.vehicles.kinds.suv).toEqual(DEFAULT_VEHICLE_SETTINGS.kinds.suv);
    const seen = new SqliteSettingsReader(h.db).vehicleSettings();
    expect(seen.kinds.sedan.maxSpeed).toBe(31);
    expect(seen.runOver.minSpeed).toBe(8);
  });

  it('edits each section and refuses invalid values', async () => {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    await h.client.put('/api/config/heist', {
      heist: { killBonus: 55, looseCashByTier: { '1': 9 } },
    });
    const heist = new SqliteSettingsReader(h.db).heistSettings();
    expect(heist.killBonus).toBe(55);
    expect(heist.looseCashByTier['1']).toBe(9);
    expect(heist.looseCashByTier['5']).toBe(DEFAULT_HEIST_SETTINGS.looseCashByTier['5']);
    await h.client.put('/api/config/atmosphere', { atmosphere: { dayMinutes: 12 } });
    expect(new SqliteSettingsReader(h.db).atmosphereSettings().dayMinutes).toBe(12);
    await h.client.put('/api/config/city', { city: { blocks: 6, seed: 'autumn' } });
    expect(new SqliteSettingsReader(h.db).citySettings()).toMatchObject({
      blocks: 6,
      seed: 'autumn',
    });
    for (const [name, bad] of [
      ['heist', { killBonus: -1 }],
      ['vehicles', { runOver: { minSpeed: -3 } }],
      ['atmosphere', { startHour: 30 }],
      ['city', { blocks: 99 }],
    ] as const) {
      expect((await h.client.put(`/api/config/${name}`, { [name]: bad })).status).toBe(400);
    }
  });

  it('lets teachers read but not write, and audits every change', async () => {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    await h.client.put('/api/config/atmosphere', { atmosphere: { startHour: 7 } });
    const audit = await h.client.get<{ entries: { entity: string; entityId: string }[] }>(
      '/api/audit',
    );
    expect(audit.body.entries[0]).toMatchObject({ entity: 'settings', entityId: 'atmosphere' });
    h.client.clearCookie();
    await h.loginAs('t@school.test', 'teacher');
    expect((await h.client.get('/api/config/city')).status).toBe(200);
    expect((await h.client.put('/api/config/city', { city: { blocks: 5 } })).status).toBe(403);
  });
});
