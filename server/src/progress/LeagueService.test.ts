import { describe, expect, it } from 'vitest';
import { DEFAULT_PROGRESSION_SETTINGS as S, type ItemRecord } from '@heist/shared';
import { InMemoryAttemptStore } from '../analytics/AttemptStore';
import { InMemoryClassResults } from '../classes/ClassResults';
import { LeagueService } from './LeagueService';

const WEEK = '2026-10-19';
const at = (iso: string) => Date.parse(iso);

const item = (over: Partial<ItemRecord>): ItemRecord =>
  ({
    challengeId: `c${Math.random()}`,
    accountId: 1,
    classId: 5,
    questionId: 1,
    questionVersion: 1,
    rewardKey: 'heal:small',
    tier: 2,
    rcsbe: 'R',
    bloom: 'apply',
    marks: 4,
    topics: ['where'],
    outcome: 'solved',
    runs: 1,
    submits: 1,
    wrongSubmits: 0,
    hintsPaid: 0,
    secondsOpen: 10,
    tutorial: false,
    issuedAt: at('2026-10-20T10:00:00Z'),
    finishedAt: at('2026-10-20T10:01:00Z'),
    ...over,
  }) as ItemRecord;

async function setup() {
  const results = new InMemoryClassResults();
  const attempts = new InMemoryAttemptStore();
  const names = new Map([[2, 'Ben']]);
  const svc = new LeagueService(
    results,
    attempts,
    () => S,
    async (id) => names.get(id),
    () => at('2026-10-21T09:00:00Z'),
  );
  return { svc, results, attempts };
}

describe('LeagueService', () => {
  it('combines cash and rounds from the week’s rounds with marks from its questions', async () => {
    const { svc, results, attempts } = await setup();
    await results.record(5, {
      number: 1,
      startedAt: at('2026-10-20T09:00:00Z'),
      endedAt: at('2026-10-20T09:15:00Z'),
      awards: [],
      standings: [{ rank: 1, accountId: 1, name: 'Ana', banked: 3000, kills: 1, deaths: 0 }],
    });
    await attempts.writeBatch(
      [],
      [{ item: item({}), who: { accountId: 1, classId: 5 } }],
      (await import('@heist/shared')).DEFAULT_ANALYTICS_SETTINGS,
    );
    const league = await svc.table(5);
    expect(league.week).toEqual({ start: WEEK, end: '2026-10-26' });
    expect(league.rows).toHaveLength(1);
    const row = league.rows[0];
    expect(row).toMatchObject({ playerId: 1, name: 'Ana', banked: 3000, rounds: 1 });
    expect(row?.earned).toBeGreaterThan(0);
    expect(row?.points).toBe((row?.learningPoints ?? 0) + 3 + 5);
  });

  it('counts a student who only answered questions, named from the account', async () => {
    const { svc, attempts } = await setup();
    await attempts.writeBatch(
      [],
      [{ item: item({ accountId: 2 }), who: { accountId: 2, classId: 5 } }],
      (await import('@heist/shared')).DEFAULT_ANALYTICS_SETTINGS,
    );
    expect((await svc.table(5)).rows.map((r) => r.name)).toEqual(['Ben']);
  });

  it('leaves out other weeks, other classes, the tutorial and tests', async () => {
    const { svc, attempts } = await setup();
    const settings = (await import('@heist/shared')).DEFAULT_ANALYTICS_SETTINGS;
    await attempts.writeBatch(
      [],
      [
        item({ finishedAt: at('2026-10-18T23:00:00Z') }), // last week
        item({ finishedAt: at('2026-10-26T00:00:00Z') }), // next week
        item({ classId: 6 }), // another class
        item({ tutorial: true }),
        item({ assessment: 'pre' }),
      ].map((i) => ({ item: i, who: { accountId: 1, classId: i.classId as number } })),
      settings,
    );
    expect((await svc.table(5)).rows).toEqual([]);
    expect((await svc.table(5, '2026-10-12')).rows).toHaveLength(1); // last week has the one item
  });
});
