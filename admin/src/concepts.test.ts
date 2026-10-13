import { afterEach, describe, expect, it } from 'vitest';
import { startAdmin } from './testing/harness';

let h: Awaited<ReturnType<typeof startAdmin>> | undefined;
afterEach(() => h?.close());

const card = { title: 'GROUP BY', nudge: 'Group the rows.', body_md: 'One row per group.' };

describe('concept cards API (16.1)', () => {
  it('a teacher creates and edits a card; every edit is a new version with history', async () => {
    h = await startAdmin();
    await h.loginAs('ana@school.test', 'teacher');
    expect((await h.client.get<{ cards: unknown[] }>('/api/concepts')).body.cards).toEqual([]);
    const first = await h.client.put<{ card: { version: number } }>('/api/concepts/group-by', card);
    expect(first.body.card.version).toBe(1);
    const second = await h.client.put<{ card: { version: number; body_md: string } }>(
      '/api/concepts/group-by',
      {
        ...card,
        body_md: 'Better words.',
      },
    );
    expect(second.body.card).toMatchObject({ version: 2, body_md: 'Better words.' });
    const got = await h.client.get<{
      card: { title: string };
      versions: { version: number; body_md: string }[];
    }>('/api/concepts/group-by');
    expect(got.body.card.title).toBe('GROUP BY');
    expect(got.body.versions.map((v) => [v.version, v.body_md])).toEqual([
      [1, 'One row per group.'],
      [2, 'Better words.'],
    ]);
    expect((await h.client.get('/api/concepts/nope')).status).toBe(404);
  });

  it('refuses a bad topic or an empty card, and audits an edit', async () => {
    h = await startAdmin();
    await h.loginAs('ana@school.test', 'teacher');
    expect((await h.client.put('/api/concepts/Bad_Topic', card)).status).toBe(400);
    expect((await h.client.put('/api/concepts/where', { ...card, body_md: '' })).status).toBe(400);
    expect(
      (await h.client.put('/api/concepts/where', { ...card, nudge: 'x'.repeat(300) })).status,
    ).toBe(400);
    await h.client.put('/api/concepts/where', card);
    await h.admin.settled();
    h.client.clearCookie();
    await h.loginAs('boss@school.test', 'admin');
    const audit = await h.client.get<{ entries: { entity: string; entityId: string }[] }>(
      '/api/audit?entity=concept',
    );
    expect(audit.body.entries[0]).toMatchObject({ entity: 'concept', entityId: 'where' });
  });

  it('needs a login', async () => {
    h = await startAdmin();
    expect((await h.client.get('/api/concepts')).status).toBe(401);
  });
});
