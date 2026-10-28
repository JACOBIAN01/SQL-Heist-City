import { describe, expect, it } from 'vitest';
import type { ItemRecord, LeaderboardMessage } from '@heist/shared';
import { InMemoryLeaderboardStore } from '../progress/LeaderboardStore';
import { OptimisationSink } from './OptimisationSink';

const item = (over: Partial<ItemRecord> = {}): ItemRecord =>
  ({
    challengeId: 'c',
    accountId: 1,
    classId: 7,
    questionId: 5,
    questionVersion: 1,
    rewardKey: 'heal:small',
    tier: 1,
    rcsbe: 'C',
    bloom: 'apply',
    marks: 1,
    topics: [],
    outcome: 'solved',
    runs: 0,
    submits: 1,
    wrongSubmits: 0,
    hintsPaid: 0,
    secondsOpen: 10,
    tutorial: false,
    issuedAt: 0,
    finishedAt: 1,
    cost: { scanned: 40, length: 50 },
    review: { title: 'Payroll Leak', story: '', modelSql: '' },
    ...over,
  }) as ItemRecord;

const settle = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const store = new InMemoryLeaderboardStore();
  const sent: { id: number; message: LeaderboardMessage }[] = [];
  const names = new Map([
    [1, 'Ana'],
    [2, 'Ben'],
  ]);
  const sink = new OptimisationSink(
    store,
    async (id) => names.get(id),
    (id, message) => sent.push({ id, message }),
    () => {},
  );
  return { sink, sent, store };
}

describe('OptimisationSink (34.4)', () => {
  it('tells a student where a solved query puts them, in their class and everywhere', async () => {
    const { sink, sent } = setup();
    sink.item(item({ accountId: 2, classId: 8, cost: { scanned: 30, length: 90 } }), {} as never);
    await settle();
    sink.item(item(), {} as never);
    await settle();
    const m = sent.at(-1)?.message;
    expect(sent.at(-1)?.id).toBe(1);
    expect(m).toMatchObject({
      question: 'Payroll Leak',
      newBest: true,
      you: { scanned: 40, length: 50 },
    });
    expect(m?.global).toMatchObject({ rank: 2, of: 2 });
    expect(m?.class).toMatchObject({ rank: 1, of: 1 }); // class 7 has only Ana
    expect(m?.global.top.map((r) => [r.name, r.you])).toEqual([
      ['Ben', false],
      ['Ana', true],
    ]);
  });

  it('says when a try is not a new best, and keeps the old one', async () => {
    const { sink, sent } = setup();
    sink.item(item({ cost: { scanned: 10, length: 20 } }), {} as never);
    await settle();
    sink.item(item({ cost: { scanned: 99, length: 99 } }), {} as never);
    await settle();
    expect(sent.at(-1)?.message.newBest).toBe(false);
    expect(sent.at(-1)?.message.global.top[0]).toMatchObject({ scanned: 10, length: 20 });
  });

  it('ignores what does not count: unsigned play, wrong answers, no cost, tutorials, assessments', async () => {
    const { sink, sent } = setup();
    for (const over of [
      { accountId: undefined },
      { outcome: 'abandoned' as const },
      { cost: undefined },
      { tutorial: true },
      { assessment: 'pre' as const },
    ])
      sink.item(item(over as Partial<ItemRecord>), {} as never);
    await settle();
    expect(sent).toHaveLength(0);
  });

  it('leaves the class out when the student is not in one', async () => {
    const { sink, sent } = setup();
    const { classId: _c, ...open } = item();
    sink.item(open as ItemRecord, {} as never);
    await settle();
    expect(sent.at(-1)?.message.class).toBeUndefined();
  });
});
