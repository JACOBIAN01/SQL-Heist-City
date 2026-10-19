import { describe, expect, it } from 'vitest';
import { DEFAULT_PROGRESSION_SETTINGS, type ItemRecord, type ProgressMessage } from '@heist/shared';
import type { RoundResult } from '../heist/HeistEvents';
import { InMemoryProgressStore } from './ProgressStore';
import { ProgressKeeper } from './ProgressKeeper';

const item = (over: Partial<ItemRecord> = {}): ItemRecord =>
  ({
    challengeId: 'c',
    accountId: 7,
    questionId: 1,
    questionVersion: 1,
    rewardKey: 'heal:small',
    tier: 2,
    rcsbe: 'R',
    bloom: 'apply',
    marks: 1,
    topics: ['joins'],
    outcome: 'solved',
    runs: 1,
    submits: 1,
    wrongSubmits: 0,
    hintsPaid: 0,
    secondsOpen: 20,
    tutorial: false,
    issuedAt: 0,
    finishedAt: 1,
    ...over,
  }) as ItemRecord;

function keeper(solved: string[] = []) {
  const store = new InMemoryProgressStore();
  const sent: { id: number; m: ProgressMessage }[] = [];
  const k = new ProgressKeeper(
    store,
    () => DEFAULT_PROGRESSION_SETTINGS,
    async () => new Set(solved),
    (id, m) => sent.push({ id, m }),
  );
  return { k, store, sent };
}

describe('ProgressKeeper', () => {
  it('pays for a solved question, more for a topic not yet solved, and tells the student', async () => {
    const { k, store, sent } = keeper();
    k.item(item(), {});
    k.item(item({ challengeId: 'd' }), {});
    await k.settled();
    // 35 base × 1.25 first try; the first is also a new topic (×1.5), the second is not.
    expect((await store.get(7)).learningXp).toBe(
      Math.round(35 * 1.25 * 1.5) + Math.round(35 * 1.25),
    );
    expect(sent.at(-1)?.m.gained).toMatchObject({ why: 'solve' });
    expect(sent.at(-1)?.m.progress.xp).toBe((await store.get(7)).learningXp);
  });

  it('knows topics solved before this visit', async () => {
    const { k, store } = keeper(['joins']);
    k.item(item(), {});
    await k.settled();
    expect((await store.get(7)).learningXp).toBe(Math.round(35 * 1.25));
  });

  it('pays nothing for the tutorial, unsolved questions or unsigned players', async () => {
    const { k, store, sent } = keeper();
    k.item(item({ tutorial: true }), {});
    k.item(item({ outcome: 'abandoned' }), {});
    const guest = item();
    delete (guest as { accountId?: number }).accountId;
    k.item(guest, {});
    await k.settled();
    expect(await store.get(7)).toEqual({ learningXp: 0, playXp: 0 });
    expect(sent).toHaveLength(0);
  });

  it('pays signed-in players for a finished round, by rank, cash and kills', async () => {
    const { k, store } = keeper();
    const result: RoundResult = {
      number: 1,
      startedAt: 0,
      endedAt: 1,
      awards: [],
      standings: [
        { rank: 1, accountId: 7, name: 'A', banked: 3000, kills: 2, deaths: 0 },
        { rank: 2, name: 'Guest', banked: 100, kills: 0, deaths: 3 },
      ],
    };
    k.roundEnded(result);
    await k.settled();
    expect((await store.get(7)).playXp).toBe(20 + 8 + 24 + 40);
  });

  it('counts answers that arrive together, in order, without losing any', async () => {
    const { k, store } = keeper(['joins']);
    for (let i = 0; i < 10; i++) k.item(item({ challengeId: `c${i}` }), {});
    await k.settled();
    expect((await store.get(7)).learningXp).toBe(10 * Math.round(35 * 1.25));
  });

  it('reports a failing store instead of crashing the match', async () => {
    const errors: unknown[] = [];
    const store = new InMemoryProgressStore();
    store.add = async () => {
      throw new Error('db down');
    };
    const k = new ProgressKeeper(
      store,
      () => DEFAULT_PROGRESSION_SETTINGS,
      async () => new Set(),
      () => {},
      (e) => errors.push(e),
    );
    k.item(item(), {});
    await k.settled();
    expect(errors).toHaveLength(1);
  });
});
