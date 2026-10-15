import { afterEach, describe, expect, it } from 'vitest';
import type { BriefView, ItemRecord } from '@heist/shared';
import { startAdmin } from '../testing/harness';

type Harness = Awaited<ReturnType<typeof startAdmin>>;
let h: Harness | undefined;
afterEach(() => h?.close());

const brief = (accountId: number, classId: number, id: string): ItemRecord => ({
  challengeId: id,
  accountId,
  classId,
  round: 1,
  questionId: 9,
  questionVersion: 1,
  rewardKey: 'brief:plan',
  tier: 3,
  rcsbe: 'B',
  bloom: 'create',
  marks: 6,
  topics: ['select'],
  outcome: 'submitted',
  runs: 1,
  submits: 1,
  wrongSubmits: 0,
  hintsPaid: 0,
  secondsOpen: 120,
  tutorial: false,
  issuedAt: 0,
  finishedAt: 1,
  review: { title: 'Plan the heist', story: 'Plan it.', modelSql: '' },
  brief: {
    text: 'Goal: the richest branch. Done when one row comes back.',
    sql: 'SELECT branch FROM accounts',
    rubric: [
      { criterion: 'Sets a goal', marks: 2 },
      { criterion: 'Checks it worked', marks: 4 },
    ],
  },
});

async function setup() {
  const harness = await startAdmin();
  h = harness;
  await harness.loginAs('teacher@school.test', 'teacher');
  const cls = (await harness.client.post<{ class: { id: number } }>('/api/classes', { name: '9B' }))
    .body.class.id;
  const ana = await harness.stores.players.upsertFromGoogle({
    sub: 'a',
    email: 'ana@school.edu',
    name: 'Ana',
    domain: null,
  });
  await harness.stores.classes.addMember(cls, ana.id);
  await harness.stores.briefs.add(brief(ana.id, cls, 'b1'));
  await harness.stores.briefs.add(brief(ana.id, cls, 'b2'));
  return { h: harness, cls, ana: ana.id };
}

describe('brief marking (17.11)', () => {
  it('queues the class’s briefs, checks marks against the rubric, and puts them in the profile', async () => {
    const { h, cls, ana } = await setup();
    const queue = await h.client.get<{ briefs: BriefView[] }>('/api/briefs');
    expect(queue.body.briefs.map((b) => b.id)).toEqual(['b1', 'b2']);

    expect((await h.client.post('/api/briefs/b1/mark', { marks: [3, 1] })).status).toBe(400);
    expect((await h.client.post('/api/briefs/b1/mark', { marks: [2] })).status).toBe(400);

    const marked = await h.client.post<{ brief: BriefView }>('/api/briefs/b1/mark', {
      marks: [2, 3],
      feedback: 'Say how you checked it.',
    });
    expect(marked.body.brief).toMatchObject({ marks: [2, 3], markedBy: 'teacher@school.test' });
    const build = async () =>
      (await h.stores.profiles.load(ana, { kind: 'class', classId: cls })).rcsbe.B;
    // 5 of 6 rubric marks on a 6-mark question.
    expect(await build()).toEqual({ earned: 5, available: 6, items: 1 });
    expect(
      (await h.client.get<{ briefs: BriefView[] }>('/api/briefs')).body.briefs.map((b) => b.id),
    ).toEqual(['b2']);

    // A re-mark moves the earned marks only: still one item, still 6 available.
    await h.client.post('/api/briefs/b1/mark', { marks: [2, 4] });
    expect(await build()).toEqual({ earned: 6, available: 6, items: 1 });
    expect(
      (await h.stores.profiles.load(ana, { kind: 'round', classId: cls, round: 1 })).bloom.create,
    ).toEqual({ earned: 6, available: 6, items: 1 });
    await h.admin.settled();
    const audit = await h.stores.audit.list({ entity: 'brief' });
    expect(audit.map((a) => a.action)).toEqual(['mark', 'mark']);
  });

  it('keeps one teacher’s briefs from another', async () => {
    const { h, cls } = await setup();
    h.client.clearCookie();
    await h.loginAs('other@school.test', 'teacher');
    expect((await h.client.get<{ briefs: BriefView[] }>('/api/briefs')).body.briefs).toEqual([]);
    expect((await h.client.get(`/api/briefs?classId=${cls}`)).status).toBe(403);
    expect((await h.client.get('/api/briefs/b1')).status).toBe(403);
    expect((await h.client.post('/api/briefs/b1/mark', { marks: [1, 1] })).status).toBe(403);
  });
});
