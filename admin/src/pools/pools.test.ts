import { afterEach, describe, expect, it } from 'vitest';
import type { Pool, QuestionDetail } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { startAdmin } from '../testing/harness';

type Harness = Awaited<ReturnType<typeof startAdmin>>;
let h: Harness | undefined;
afterEach(() => h?.close());

async function setup() {
  h = await startAdmin();
  await h.loginAs('t@school.test');
  const ids: number[] = [];
  for (const slug of ['q-a', 'q-b']) {
    ids.push(
      (
        await h.client.post<{ question: QuestionDetail }>('/api/questions', {
          ...sampleQuestion,
          slug,
        })
      ).body.question.id,
    );
  }
  return { client: h.client, ids };
}

describe('pools API', () => {
  it('creates, lists, updates and deletes pools', async () => {
    const { client, ids } = await setup();
    const created = await client.post<{ pool: Pool }>('/api/pools', {
      name: 'Week 3: JOINs',
      questionIds: [ids[0], ids[0]],
    });
    expect(created).toMatchObject({
      status: 201,
      body: { pool: { name: 'Week 3: JOINs', questionIds: [ids[0]], createdBy: 't@school.test' } },
    });
    const id = created.body.pool.id;

    const updated = await client.put<{ pool: Pool }>(`/api/pools/${id}`, {
      name: 'Week 3',
      description: 'joins',
      questionIds: ids,
    });
    expect(updated.body.pool).toMatchObject({
      name: 'Week 3',
      description: 'joins',
      questionIds: ids,
    });
    expect((await client.get<{ pools: Pool[] }>('/api/pools')).body.pools).toHaveLength(1);

    expect((await client.del(`/api/pools/${id}`)).status).toBe(204);
    expect((await client.get(`/api/pools/${id}`)).status).toBe(404);
    const actions = h?.db
      .prepare("SELECT action FROM audit_log WHERE entity = 'pool' ORDER BY id")
      .all()
      .map((r) => (r as { action: string }).action);
    expect(actions).toEqual(['create', 'update', 'delete']);
  });

  it('rejects duplicate names and unknown question ids', async () => {
    const { client } = await setup();
    await client.post('/api/pools', { name: 'Finals' });
    expect((await client.post('/api/pools', { name: 'finals' })).status).toBe(409);
    expect(await client.post('/api/pools', { name: 'Other', questionIds: [999] })).toMatchObject({
      status: 400,
      body: { error: { code: 'unknown_questions' } },
    });
  });

  it('drops a deleted question from pools automatically', async () => {
    const { client, ids } = await setup();
    const { pool } = (
      await client.post<{ pool: Pool }>('/api/pools', { name: 'P', questionIds: ids })
    ).body;
    h?.db.prepare('DELETE FROM questions WHERE id = ?').run(ids[0] ?? 0);
    expect(
      (await client.get<{ pool: Pool }>(`/api/pools/${pool.id}`)).body.pool.questionIds,
    ).toEqual([ids[1]]);
  });
});
