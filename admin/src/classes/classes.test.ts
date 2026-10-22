import { afterEach, describe, expect, it } from 'vitest';
import { emptyTotals, questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { startAdmin } from '../testing/harness';

type Harness = Awaited<ReturnType<typeof startAdmin>>;
let h: Harness | undefined;
afterEach(() => h?.close());

interface Cls {
  id: number;
  code: string;
  name: string;
  banksOpen: number[];
  playerCap: number;
  ownerUserId: number | null;
}

async function boot() {
  h = await startAdmin();
  await h.loginAs('ana@school.test', 'teacher');
  return h;
}
const make = async (name = '9B SQL', extra: object = {}) =>
  (await (h as Harness).client.post<{ class: Cls }>('/api/classes', { name, ...extra })).body.class;

describe('class API (14.2, 14.3)', () => {
  it('a teacher creates a class with a join code and sensible defaults', async () => {
    await boot();
    const res = await (h as Harness).client.post<{ class: Cls }>('/api/classes', {
      name: '  9B SQL  ',
    });
    expect(res.status).toBe(201);
    expect(res.body.class).toMatchObject({
      name: '9B SQL',
      banksOpen: [1, 2, 3, 4, 5],
      playerCap: 100,
    });
    expect(res.body.class.code).toMatch(/^[A-Z0-9]{6}$/);
    expect((await (h as Harness).client.post('/api/classes', { name: '' })).status).toBe(400);
    expect(
      (await (h as Harness).client.post('/api/classes', { name: 'x', playerCap: 30 })).status,
    ).toBe(400);
  });

  it('editing one thing keeps the rest; banks can be closed', async () => {
    await boot();
    const c = await make('A', { banksOpen: [1, 2], roundMinutes: 9 });
    const put = await (h as Harness).client.put<{ class: Cls & { roundMinutes: number } }>(
      `/api/classes/${c.id}`,
      {
        name: 'Renamed',
      },
    );
    expect(put.body.class).toMatchObject({ name: 'Renamed', banksOpen: [1, 2], roundMinutes: 9 });
    const closed = await (h as Harness).client.put<{ class: Cls }>(`/api/classes/${c.id}`, {
      banksOpen: [3, 3, 1],
    });
    expect(closed.body.class.banksOpen).toEqual([1, 3]);
    expect(
      (await (h as Harness).client.put(`/api/classes/${c.id}`, { banksOpen: [9] })).status,
    ).toBe(400);
  });

  it('a teacher sees only their own classes; an admin sees all; others get 403', async () => {
    await boot();
    const mine = await make('Mine');
    const bob = (h as Harness).client;
    bob.clearCookie();
    await (h as Harness).loginAs('bob@school.test', 'teacher');
    const theirs = await make('Theirs');
    expect(
      (await bob.get<{ classes: Cls[] }>('/api/classes')).body.classes.map((c) => c.id),
    ).toEqual([theirs.id]);
    expect((await bob.get(`/api/classes/${mine.id}`)).status).toBe(403);
    expect((await bob.put(`/api/classes/${mine.id}`, { name: 'Hijack' })).status).toBe(403);
    expect((await bob.del(`/api/classes/${mine.id}`)).status).toBe(403);
    expect((await bob.get('/api/classes/9999')).status).toBe(404);
    bob.clearCookie();
    await (h as Harness).loginAs('boss@school.test', 'admin');
    expect((await bob.get<{ classes: Cls[] }>('/api/classes')).body.classes.length).toBe(2);
    expect((await bob.get(`/api/classes/${mine.id}`)).status).toBe(200);
  });

  it('archives a class and makes a fresh code on request', async () => {
    await boot();
    const c = await make();
    const next = await (h as Harness).client.post<{ class: Cls }>(`/api/classes/${c.id}/code`);
    expect(next.body.class.code).not.toBe(c.code);
    expect((await (h as Harness).client.del(`/api/classes/${c.id}`)).status).toBe(204);
    expect(
      (await (h as Harness).client.get<{ classes: Cls[] }>('/api/classes')).body.classes,
    ).toEqual([]);
    expect(
      (await (h as Harness).client.get<{ classes: Cls[] }>('/api/classes?archived=1')).body.classes
        .length,
    ).toBe(1);
  });

  it('releases questions by what they are for, with their titles, and refuses unknown ones', async () => {
    await boot();
    const c = await make();
    const made = await (h as Harness).client.post<{ question: { id: number } }>(
      '/api/questions',
      questionTemplateSchema.parse(sampleQuestion),
    );
    const q = made.body.question.id;
    const put = await (h as Harness).client.put(`/api/classes/${c.id}/questions`, {
      links: [
        { questionId: q, usage: 'heal' },
        { questionId: q, usage: 'vault' },
      ],
    });
    expect(put.status).toBe(200);
    const got = await (h as Harness).client.get<{
      links: { usage: string; title: string; tier: number }[];
    }>(`/api/classes/${c.id}/questions`);
    expect(got.body.links.map((l) => l.usage)).toEqual(['heal', 'vault']);
    expect(got.body.links[0]).toMatchObject({
      title: questionTemplateSchema.parse(sampleQuestion).title,
    });
    expect(
      (
        await (h as Harness).client.put(`/api/classes/${c.id}/questions`, {
          links: [{ questionId: 9999, usage: 'gun' }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await (h as Harness).client.put(`/api/classes/${c.id}/questions`, {
          links: [{ questionId: q, usage: 'nuke' }],
        })
      ).status,
    ).toBe(400);
  });

  it('writes an audit entry for each change', async () => {
    await boot();
    const c = await make();
    await (h as Harness).client.put(`/api/classes/${c.id}`, { name: 'B' });
    await (h as Harness).admin.settled();
    (h as Harness).client.clearCookie();
    await (h as Harness).loginAs('boss@school.test', 'admin');
    const audit = await (h as Harness).client.get<{
      entries: { entity: string; action: string }[];
    }>('/api/audit?entity=class');
    expect(audit.body.entries.map((e) => e.action)).toEqual(['update', 'create']);
  });
});

describe('weekly league (26.6)', () => {
  it('shows a class’s week, ranking learning above cash, and refuses a day that is not a Monday', async () => {
    await boot();
    const c = await make('League');
    const hh = h as Harness;
    const ana = await hh.stores.players.upsertFromGoogle({
      sub: 'g1',
      email: 'a@x.test',
      name: 'Ana',
      domain: null,
    });
    const ben = await hh.stores.players.upsertFromGoogle({
      sub: 'g2',
      email: 'b@x.test',
      name: 'Ben',
      domain: null,
    });
    const week = '2026-10-19';
    const ended = Date.parse('2026-10-21T10:00:00Z');
    await hh.stores.classResults.record(c.id, {
      number: 1,
      startedAt: ended - 900_000,
      endedAt: ended,
      awards: [],
      standings: [
        { rank: 1, accountId: ana.id, name: 'Ana', banked: 400_000, kills: 5, deaths: 0 },
        { rank: 2, accountId: ben.id, name: 'Ben', banked: 1000, kills: 0, deaths: 2 },
      ],
    });
    const res = await hh.client.get<{
      week: { start: string; end: string };
      rows: { name: string; rank: number; cashPoints: number; points: number }[];
    }>(`/api/classes/${c.id}/league?week=${week}`);
    expect(res.status).toBe(200);
    expect(res.body.week).toEqual({ start: week, end: '2026-10-26' });
    expect(res.body.rows.map((r) => r.name)).toEqual(['Ana', 'Ben']);
    expect(res.body.rows[0]?.cashPoints).toBe(100); // 400 → capped
    expect((await hh.client.get(`/api/classes/${c.id}/league?week=2026-10-20`)).status).toBe(400);
    expect((await hh.client.get(`/api/classes/${c.id}/league?week=2026-10-12`)).body).toMatchObject(
      { rows: [] },
    );
  });
});

describe('squads (27.2)', () => {
  async function classWithStudents(n: number, extra: object = {}) {
    await boot();
    const hh = h as Harness;
    const c = await make('Squad class', extra);
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = await hh.stores.players.upsertFromGoogle({
        sub: `s${i}`,
        email: `s${i}@x.test`,
        name: `S${i}`,
        domain: null,
      });
      await hh.stores.classes.addMember(c.id, p.id);
      ids.push(p.id);
    }
    return { c, ids, hh };
  }

  it('is off by default, with a mode and size a teacher can set', async () => {
    const { c, hh } = await classWithStudents(0);
    const view = await hh.client.get<{ mode: string; size: number; max: number }>(
      `/api/classes/${c.id}/squads`,
    );
    expect(view.body).toMatchObject({ mode: 'off', size: 4, max: 10 });
    const put = await hh.client.put<{ class: { squadMode: string; squadSize: number } }>(
      `/api/classes/${c.id}`,
      {
        squadMode: 'teacher',
        squadSize: 3,
      },
    );
    expect(put.body.class).toMatchObject({ squadMode: 'teacher', squadSize: 3 });
    expect((await hh.client.put(`/api/classes/${c.id}`, { squadSize: 7 })).status).toBe(400);
  });

  it('saves the teacher’s list, refuses a squad that is too big or out of range, and ignores non-members', async () => {
    const { c, ids, hh } = await classWithStudents(4, { squadMode: 'teacher', squadSize: 3 });
    const ok = await hh.client.put<{ assignments: Record<string, number> }>(
      `/api/classes/${c.id}/squads`,
      {
        assignments: {
          [ids[0] as number]: 1,
          [ids[1] as number]: 1,
          [ids[2] as number]: 2,
          999999: 2,
        },
      },
    );
    expect(ok.status).toBe(200);
    expect(ok.body.assignments).toEqual({
      [ids[0] as number]: 1,
      [ids[1] as number]: 1,
      [ids[2] as number]: 2,
    });
    const tooBig = await hh.client.put(`/api/classes/${c.id}/squads`, {
      assignments: Object.fromEntries(ids.map((id) => [id, 1])),
    });
    expect(tooBig.status).toBe(400);
    expect(
      (
        await hh.client.put(`/api/classes/${c.id}/squads`, {
          assignments: { [ids[0] as number]: 99 },
        })
      ).status,
    ).toBe(400);
    // The failed saves changed nothing.
    expect(
      Object.keys(
        (await hh.client.get<{ assignments: object }>(`/api/classes/${c.id}/squads`)).body
          .assignments,
      ),
    ).toHaveLength(3);
  });

  it('balances by mastery: strong and weak students are spread, and the class becomes "auto"', async () => {
    const { c, ids, hh } = await classWithStudents(6, { squadSize: 3 });
    // Two clearly strong students, two weak, two without enough evidence.
    const give = async (id: number, earned: number) => {
      const empty = emptyTotals();
      await hh.stores.profiles.add(id, [{ kind: 'all' }], {
        ...empty,
        rcsbe: { ...empty.rcsbe, R: { earned, available: 100, items: 10 } },
      });
    };
    await give(ids[0] as number, 95);
    await give(ids[1] as number, 90);
    await give(ids[2] as number, 20);
    await give(ids[3] as number, 15);
    const res = await hh.client.post<{ mode: string; assignments: Record<string, number> }>(
      `/api/classes/${c.id}/squads/balance`,
      {},
    );
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('auto');
    const a = res.body.assignments;
    expect(Object.keys(a)).toHaveLength(6);
    expect(a[String(ids[0])]).not.toBe(a[String(ids[1])]); // the two strongest are split
    const per = new Map<number, number>();
    for (const s of Object.values(a)) per.set(s, (per.get(s) ?? 0) + 1);
    expect([...per.values()].sort()).toEqual([3, 3]);
  });
});
