import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { TEST_DATABASE_URL, freshPg } from '@heist/server/pg/testing';
import { startAdmin } from './testing/harness';

// The whole admin (login, questions, settings, audit) on PostgreSQL.
describe.skipIf(!TEST_DATABASE_URL)('admin on PostgreSQL', () => {
  let h: Awaited<ReturnType<typeof startAdmin>>;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    const fresh = await freshPg();
    drop = fresh.drop;
    h = await startAdmin({ pg: fresh.db });
    await h.loginAs('a@school.test', 'admin');
  });
  afterAll(async () => {
    await h.close();
    await drop();
  });

  it('logs in, saves a question and reads it back', async () => {
    const template = questionTemplateSchema.parse(sampleQuestion);
    const created = await h.client.post<{ question: { id: number } }>('/api/questions', template);
    expect(created.status).toBe(201);
    const list = await h.client.get<{ questions: { slug: string }[] }>('/api/questions');
    expect(list.body.questions.map((q) => q.slug)).toEqual([template.slug]);
    const one = await h.client.get<{ question: { template: { title: string } } }>(
      `/api/questions/${created.body.question.id}`,
    );
    expect(one.body.question.template.title).toBe(template.title);
  });

  it('edits settings and reward tiers, and audits the change', async () => {
    await h.client.put('/api/config/vehicles', {
      vehicles: { kinds: { sedan: { maxSpeed: 31 } } },
    });
    const got = await h.client.get<{
      vehicles: { current: { kinds: { sedan: { maxSpeed: number } } } };
    }>('/api/config/vehicles');
    expect(got.body.vehicles.current.kinds.sedan.maxSpeed).toBe(31);
    await h.client.put('/api/config/reward-map', {
      rewards: [{ key: 'gun:rifle', min: 2, max: 3 }],
    });
    const rewards = await h.client.get<{ rewards: { key: string; min: number }[] }>(
      '/api/config/reward-map',
    );
    expect(rewards.body.rewards.find((r) => r.key === 'gun:rifle')?.min).toBe(2);
    await h.admin.settled();
    const audit = await h.client.get<{ entries: { entity: string; entityId: string }[] }>(
      '/api/audit',
    );
    expect(audit.body.entries.map((e) => e.entityId)).toEqual(
      expect.arrayContaining(['vehicles', 'reward_map']),
    );
  });

  it('keeps pools and users working', async () => {
    const pool = await h.client.post<{ pool: { id: number } }>('/api/pools', {
      name: 'Week 1',
      description: '',
      questionIds: [],
    });
    expect(pool.status).toBe(201);
    const users = await h.client.get<{ users: { email: string }[] }>('/api/users');
    expect(users.body.users.map((u) => u.email)).toContain('a@school.test');
  });
});
