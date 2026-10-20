import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROGRESSION_SETTINGS as S,
  dealContracts,
  type ContractsMessage,
  type ItemRecord,
} from '@heist/shared';
import { ContractKeeper } from './ContractKeeper';
import { InMemoryContractStore } from './ContractStore';

const item = (over: Partial<ItemRecord> = {}): ItemRecord =>
  ({
    challengeId: 'c',
    accountId: 7,
    questionId: 1,
    questionVersion: 1,
    rewardKey: 'heal:small',
    tier: 5,
    rcsbe: 'R',
    bloom: 'apply',
    marks: 1,
    topics: ['where', 'window'],
    outcome: 'solved',
    runs: 1,
    submits: 1,
    wrongSubmits: 0,
    hintsPaid: 0,
    secondsOpen: 5,
    tutorial: false,
    issuedAt: 0,
    finishedAt: 1,
    ...over,
  }) as ItemRecord;

const DAY1 = Date.UTC(2026, 9, 20, 10);
const DAY2 = DAY1 + 86_400_000;

function keeper(start = DAY1) {
  const clock = { now: start };
  const store = new InMemoryContractStore();
  const paid: number[] = [];
  const sent: ContractsMessage[] = [];
  // Settings that make every contract easy to finish: the day's dealing is then predictable.
  const settings = {
    ...S,
    contracts: {
      ...S.contracts,
      templates: [
        { id: 'clean-1', kind: 'clean' as const, count: 1, xp: 40 },
        { id: 'tier-2', kind: 'tier' as const, tier: 3, count: 2, xp: 60 },
      ],
      perDay: 2,
    },
  };
  const k = new ContractKeeper(
    store,
    () => settings,
    () => clock.now,
    async (_id, xp) => void paid.push(xp),
    (_id, m) => sent.push(m),
  );
  return { k, store, paid, sent, clock, settings };
}

describe('ContractKeeper', () => {
  it('deals the day on first look, and the same ones again later', async () => {
    const { k, settings } = keeper();
    const a = await k.messageOf(7);
    expect(a.contracts.map((c) => c.id).sort()).toEqual(['clean-1', 'tier-2']);
    expect(a.streak).toEqual({ days: 0, bonusPct: 0 });
    expect((await k.messageOf(7)).contracts.map((c) => c.id)).toEqual(
      dealContracts('2026-10-20', 7, settings).map((c) => c.id),
    );
  });

  it('fills contracts as questions end, pays once when one is done, and tells the student', async () => {
    const { k, paid, sent } = keeper();
    await k.messageOf(7);
    k.item(item(), {});
    await k.settled();
    expect(paid).toEqual([40]); // clean-1 done at once; the first day has no streak bonus
    expect(sent.at(-1)?.completed).toEqual(['clean-1']);
    expect(sent.at(-1)?.contracts.find((c) => c.id === 'tier-2')).toMatchObject({
      progress: 1,
      done: false,
    });
    k.item(item({ challengeId: 'd' }), {});
    await k.settled();
    expect(paid).toEqual([40, 60]);
    k.item(item({ challengeId: 'e' }), {});
    await k.settled();
    expect(paid).toEqual([40, 60]); // nothing more to pay today
  });

  it('keeps a day streak and pays a little more for it', async () => {
    const { k, paid, clock, sent } = keeper();
    k.item(item(), {});
    await k.settled();
    clock.now = DAY2;
    k.item(item({ challengeId: 'n' }), {});
    await k.settled();
    expect(paid.at(-1)).toBe(44); // 40 × 1.1: the second day in a row
    expect(sent.at(-1)?.streak).toEqual({ days: 2, bonusPct: 10 });
    // A missed day starts again.
    clock.now = DAY2 + 3 * 86_400_000;
    expect((await k.messageOf(7)).streak.days).toBe(0);
    k.item(item({ challengeId: 'm' }), {});
    await k.settled();
    expect(paid.at(-1)).toBe(40);
  });

  it('ignores the tutorial, unsigned players and questions that do not count', async () => {
    const { k, paid, sent } = keeper();
    k.item(item({ tutorial: true }), {});
    k.item(item({ wrongSubmits: 2, tier: 1 }), {});
    const guest = item();
    delete (guest as { accountId?: number }).accountId;
    k.item(guest, {});
    await k.settled();
    expect(paid).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('clears contracts older than the days kept, once a day', async () => {
    const { k, store, clock } = keeper();
    await store.putDay(7, '2026-08-01', [{ id: 'clean-1', progress: 0, done: false }]);
    await store.putDay(7, '2026-10-10', [{ id: 'clean-1', progress: 0, done: false }]);
    await k.messageOf(7);
    expect(await store.getDay(7, '2026-08-01')).toBeUndefined();
    expect(await store.getDay(7, '2026-10-10')).toBeDefined(); // within 30 days
    clock.now = DAY1 + 40 * 86_400_000;
    await k.messageOf(7);
    expect(await store.getDay(7, '2026-10-10')).toBeUndefined();
  });
});
