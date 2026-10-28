import { afterEach, describe, expect, it } from 'vitest';
import { questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { startAdmin } from '../testing/harness';

type Harness = Awaited<ReturnType<typeof startAdmin>>;
let h: Harness | undefined;
afterEach(() => h?.close());

const slug = questionTemplateSchema.parse(sampleQuestion).slug;
const body = (over: object = {}) => ({
  name: 'Library job',
  locks: [slug],
  story: { title: 'The library', lines: [{ speaker: 'Mae', text: 'Quietly now.' }] },
  ...over,
});

interface Heist {
  id: number;
  name: string;
  shareCode: string;
  mode: string;
  spec: { locks: string[] };
}

async function boot() {
  h = await startAdmin();
  await h.loginAs('ana@school.test', 'teacher');
  await h.client.post('/api/questions', questionTemplateSchema.parse(sampleQuestion));
  return h;
}

describe('custom heists API (34.5)', () => {
  it('a teacher builds a heist and gets a share code and the mode a class takes to play it', async () => {
    const t = await boot();
    const res = await t.client.post<{ heist: Heist }>('/api/custom-heists', body());
    expect(res.status).toBe(201);
    expect(res.body.heist).toMatchObject({
      name: 'Library job',
      mode: `custom-${res.body.heist.id}`,
    });
    expect(res.body.heist.shareCode).toMatch(/^[A-Z2-9]{8}$/);
    const list = await t.client.get<{ heists: Heist[] }>('/api/custom-heists');
    expect(list.body.heists.map((x) => x.id)).toEqual([res.body.heist.id]);
  });

  it('refuses a heist with no questions, or with a question that does not exist', async () => {
    const t = await boot();
    expect((await t.client.post('/api/custom-heists', body({ locks: [] }))).status).toBe(400);
    const missing = await t.client.post(
      '/api/custom-heists',
      body({ locks: ['no-such-question'] }),
    );
    expect(missing.status).toBe(422);
  });

  it('edits and deletes only the teacher’s own; an admin may touch any', async () => {
    const t = await boot();
    const made = (await t.client.post<{ heist: Heist }>('/api/custom-heists', body())).body.heist;
    const put = await t.client.put<{ heist: Heist }>(
      `/api/custom-heists/${made.id}`,
      body({ name: 'Renamed' }),
    );
    expect(put.body.heist).toMatchObject({ name: 'Renamed', shareCode: made.shareCode });
    t.client.clearCookie();
    await t.loginAs('bob@school.test', 'teacher');
    expect((await t.client.get(`/api/custom-heists/${made.id}`)).status).toBe(403);
    expect((await t.client.request('DELETE', `/api/custom-heists/${made.id}`)).status).toBe(403);
    expect((await t.client.get<{ heists: Heist[] }>('/api/custom-heists')).body.heists).toEqual([]);
    t.client.clearCookie();
    await t.loginAs('root@school.test', 'admin');
    expect((await t.client.request('DELETE', `/api/custom-heists/${made.id}`)).status).toBe(204);
  });

  it('another teacher copies it by code, and gets a copy of their own', async () => {
    const t = await boot();
    const made = (await t.client.post<{ heist: Heist }>('/api/custom-heists', body())).body.heist;
    t.client.clearCookie();
    await t.loginAs('bob@school.test', 'teacher');
    const copy = await t.client.post<{ heist: Heist }>('/api/custom-heists/import', {
      code: made.shareCode.toLowerCase(),
    });
    expect(copy.status).toBe(201);
    expect(copy.body.heist.id).not.toBe(made.id);
    expect(copy.body.heist.name).toBe('Library job (copy)');
    expect(copy.body.heist.shareCode).not.toBe(made.shareCode);
    expect(
      (await t.client.get<{ heists: Heist[] }>('/api/custom-heists')).body.heists,
    ).toHaveLength(1);
    expect((await t.client.post('/api/custom-heists/import', { code: 'ZZZZZZZZ' })).status).toBe(
      404,
    );
    expect((await t.client.post('/api/custom-heists/import', { code: 'nope' })).status).toBe(400);
  });
});
