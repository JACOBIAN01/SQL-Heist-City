import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_SETTINGS, type RewardTierEntry } from '@heist/shared';
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
