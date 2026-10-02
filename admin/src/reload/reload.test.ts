import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { QuestionDetail } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { createHttpServer } from '@heist/server/http/httpServer';
import { CachedQuestionReader } from '@heist/server/questions/CachedQuestionReader';
import { SqliteQuestionRepository } from '@heist/server/questions/SqliteQuestionRepository';
import { startAdmin } from '../testing/harness';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

describe('admin → game hot reload', () => {
  it('a teacher edit reaches the game server without a restart', async () => {
    const secret = 'test-secret';
    // Game side: cached reader + reload endpoint. Admin side: real admin app.
    const gameSide: { reader?: CachedQuestionReader } = {};
    const game = createHttpServer({
      now: () => 0,
      startedAt: 0,
      internalSecret: secret,
      onReload: () => gameSide.reader?.invalidate(),
    });
    await new Promise<void>((done) => game.listen(0, done));
    cleanups.push(() => new Promise((done) => game.close(() => done())));
    const url = `http://127.0.0.1:${(game.address() as AddressInfo).port}`;

    const h = await startAdmin({ gameServer: { url, secret } });
    cleanups.push(h.close);
    const reader = new CachedQuestionReader(new SqliteQuestionRepository(h.db));
    gameSide.reader = reader;
    await h.loginAs('t@school.test');

    expect(reader.list({ enabled: true })).toHaveLength(0); // warms the cache
    const { id } = (
      await h.client.post<{ question: QuestionDetail }>('/api/questions', sampleQuestion)
    ).body.question;
    await h.close(); // flushes the pending reload
    cleanups.pop();
    expect(reader.list({ enabled: true }).map((q) => q.id)).toEqual([id]);
  });

  it('a missing game server is logged, not fatal', async () => {
    const h = await startAdmin({ gameServer: { url: 'http://127.0.0.1:9', secret: 'x' } });
    cleanups.push(h.close);
    await h.loginAs('t@school.test');
    expect((await h.client.post('/api/questions', sampleQuestion)).status).toBe(201);
    await h.close();
    cleanups.pop();
    expect(h.errors.join('\n')).toMatch(/could not reach game server/);
  });
});
