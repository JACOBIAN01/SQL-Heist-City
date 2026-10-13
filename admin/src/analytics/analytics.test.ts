import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ANALYTICS_SETTINGS as S,
  addItem,
  emptyTotals,
  questionTemplateSchema,
  type ItemRecord,
} from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { startAdmin } from '../testing/harness';

type Harness = Awaited<ReturnType<typeof startAdmin>>;
let h: Harness | undefined;
afterEach(() => h?.close());

let n = 0;
const item = (over: Partial<ItemRecord> = {}): ItemRecord => ({
  challengeId: `c${++n}`,
  questionId: 1,
  questionVersion: 1,
  rewardKey: 'heal:small',
  tier: 2,
  rcsbe: 'S',
  bloom: 'apply',
  marks: 3,
  topics: ['join'],
  outcome: 'solved',
  runs: 1,
  submits: 1,
  wrongSubmits: 0,
  hintsPaid: 0,
  secondsOpen: 20,
  tutorial: false,
  issuedAt: 0,
  finishedAt: n,
  ...over,
});

/** A class with two students who have played: Ana strong at Solve, Ben failing Comprehend. */
async function setup() {
  const harness = await startAdmin();
  h = harness;
  await harness.loginAs('teacher@school.test', 'teacher');
  const cls = (await harness.client.post<{ class: { id: number } }>('/api/classes', { name: '9B' }))
    .body.class;
  const q = (
    await harness.client.post<{ question: { id: number } }>('/api/questions', {
      ...questionTemplateSchema.parse(sampleQuestion),
      rcsbe: 'S',
    })
  ).body.question.id;
  await harness.stores.classes.setQuestions(cls.id, [{ questionId: q, usage: 'heal' }]);
  const ana = await harness.stores.players.upsertFromGoogle({
    sub: 'a',
    email: 'ana@school.edu',
    name: 'Ana',
    domain: null,
  });
  const ben = await harness.stores.players.upsertFromGoogle({
    sub: 'b',
    email: 'ben@school.edu',
    name: 'Ben',
    domain: null,
  });
  for (const p of [ana, ben]) await harness.stores.classes.addMember(cls.id, p.id);

  const played = async (accountId: number, round: number, rows: Partial<ItemRecord>[]) => {
    let totals = emptyTotals();
    const items = rows.map((r) => item({ accountId, classId: cls.id, round, questionId: q, ...r }));
    for (const it of items) totals = addItem(totals, it, S);
    await harness.stores.attempts.writeBatch(
      [],
      items.map((i) => ({ item: i, who: { accountId, classId: cls.id, round } })),
      S,
    );
    await harness.stores.profiles.add(
      accountId,
      [
        { kind: 'all' },
        { kind: 'class', classId: cls.id },
        { kind: 'round', classId: cls.id, round },
      ],
      totals,
    );
  };
  await played(ana.id, 1, [{}, {}, {}, {}]);
  await played(ben.id, 1, [
    { rcsbe: 'C', bloom: 'understand', outcome: 'expired', submits: 1, topics: ['group'] },
    { rcsbe: 'C', bloom: 'understand', outcome: 'expired', submits: 1, topics: ['group'] },
    { rcsbe: 'C', bloom: 'understand', outcome: 'expired', submits: 1, topics: ['group'] },
  ]);
  await played(ben.id, 2, [{}, {}, {}]);
  return { h: harness, cls: cls.id, ana: ana.id, ben: ben.id, q };
}

describe('class analytics API (15.11–15.16, 15.18)', () => {
  it('shows the class profile, each student weakest first, the spread and the paper against the target', async () => {
    const { h, cls } = await setup();
    const res = await h.client.get<{
      class: { rcsbe: { dimension: string; items: number }[] };
      students: { name: string; rcsbe: { dimension: string; score: number | null }[] }[];
      spread: { rcsbe: { dimension: string; students: number }[] };
      paper: {
        problems: string[];
        questions: number;
        rows: { dimension: string; status: string }[];
      };
      target: Record<string, number>;
    }>(`/api/classes/${cls}/analytics`);
    expect(res.status).toBe(200);
    expect(res.body.target).toEqual(S.targetProfile);
    expect(res.body.class.rcsbe.find((a) => a.dimension === 'S')?.items).toBe(7);
    // Ben has a 0% axis, so he is first; Ana has only Solve.
    expect(res.body.students.map((s) => s.name)).toEqual(['Ben', 'Ana']);
    expect(res.body.spread.rcsbe.find((s) => s.dimension === 'S')?.students).toBe(2);
    expect(res.body.paper.questions).toBe(1);
    expect(res.body.paper.problems).toContain('Comprehend has no questions, target 25%');
    expect(res.body.paper.rows.find((r) => r.dimension === 'S')?.status).toBe('high');
  });

  it('shows one student: profile over the class, per-round trend, topics and where to practise', async () => {
    const { h, cls, ben } = await setup();
    const res = await h.client.get<{
      player: { name: string };
      profile: {
        rcsbe: { dimension: string; score: number | null }[];
        focus?: { dimension: string };
      };
      trend: { round: number }[];
      topics: { topic: string; score: number | null }[];
      weakestTopics: { topic: string }[];
      remediation: { dimension: string } | null;
      items: number;
    }>(`/api/classes/${cls}/students/${ben}`);
    expect(res.body.player.name).toBe('Ben');
    expect(res.body.profile.focus).toEqual({ lens: 'rcsbe', dimension: 'C' });
    expect(res.body.remediation?.dimension).toBe('C');
    expect(res.body.trend.map((t) => t.round)).toEqual([1, 2]);
    expect(res.body.topics.find((t) => t.topic === 'group')?.score).toBe(0);
    expect(res.body.weakestTopics[0]?.topic).toBe('group');
    expect(res.body.items).toBe(6);
  });

  it('keeps students’ profiles from other teachers, and from other classes’ students', async () => {
    const { h, cls, ana } = await setup();
    h.client.clearCookie();
    await h.loginAs('other@school.test', 'teacher');
    for (const path of [`/analytics`, `/students/${ana}`, `/items`, `/export.csv`])
      expect((await h.client.get(`/api/classes/${cls}${path}`)).status, path).toBe(403);
    // Their own empty class: a student of someone else's class is simply not found.
    const mine = (await h.client.post<{ class: { id: number } }>('/api/classes', { name: 'Mine' }))
      .body.class.id;
    expect((await h.client.get(`/api/classes/${mine}/students/${ana}`)).status).toBe(404);
    expect(
      (await h.client.get<{ students: unknown[] }>(`/api/classes/${mine}/analytics`)).body.students,
    ).toEqual([]);
  });

  it('analyses each question: solve rate, wrong rate, time, and flags', async () => {
    const { h, cls, q } = await setup();
    const res = await h.client.get<{
      items: {
        questionId: number;
        title: string;
        attempts: number;
        solveRate: number;
        flags: string[];
      }[];
    }>(`/api/classes/${cls}/items`);
    expect(res.body.items[0]).toMatchObject({
      questionId: q,
      attempts: 10,
      solveRate: 0.7,
      title: questionTemplateSchema.parse(sampleQuestion).title,
    });
  });

  it('exports profiles and questions as spreadsheets', async () => {
    const { h, cls } = await setup();
    const profiles = await h.client.get<string>(`/api/classes/${cls}/export.csv`);
    expect(profiles.headers.get('content-type')).toContain('text/csv');
    expect(profiles.headers.get('content-disposition')).toContain('attachment');
    const lines = (profiles.body as string).trim().split('\n');
    expect(lines[0]).toContain('student_id,student,lens,dimension');
    expect(lines.length).toBe(1 + 2 * 11);
    expect(lines.some((l) => l.includes(',Ben,rcsbe,C,0,9,3,0,yes'))).toBe(true);
    const items = await h.client.get<string>(`/api/classes/${cls}/export.csv?kind=items`);
    expect((items.body as string).split('\n')[0]).toContain('solve_rate');
  });

  it('works for a class nobody has played yet', async () => {
    const harness = await startAdmin();
    h = harness;
    await harness.loginAs('t@school.test', 'teacher');
    const cls = (
      await harness.client.post<{ class: { id: number } }>('/api/classes', { name: 'New' })
    ).body.class.id;
    const res = await harness.client.get<{ students: unknown[]; paper: { questions: number } }>(
      `/api/classes/${cls}/analytics`,
    );
    expect(res.body).toMatchObject({ students: [], paper: { questions: 0 } });
    expect(
      (await harness.client.get<{ items: unknown[] }>(`/api/classes/${cls}/items`)).body.items,
    ).toEqual([]);
  });
});
