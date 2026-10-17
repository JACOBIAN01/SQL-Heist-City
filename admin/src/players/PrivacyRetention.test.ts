import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PRIVACY_SETTINGS,
  classInputSchema,
  emptyTotals,
  type ItemRecord,
} from '@heist/shared';
import { PRIVACY_SETTINGS_KEY } from '@heist/server/config/SettingsReader';
import { TEST_DATABASE_URL, freshPg } from '@heist/server/pg/testing';
import { startAdmin } from '../testing/harness';

type Harness = Awaited<ReturnType<typeof startAdmin>>;
let h: Harness | undefined;
afterEach(() => h?.close());

const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 17);

/** The real clean-up job, wired as in production, on a clock the test can move. */
const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

/** `real`: on PostgreSQL, where deleting a student really removes what is keyed to them. */
async function setup(days: Partial<typeof DEFAULT_PRIVACY_SETTINGS> = {}, real = false) {
  let now = START;
  let pg;
  if (real) {
    const fresh = await freshPg();
    drops.push(fresh.drop);
    pg = fresh.db;
  }
  const harness = await startAdmin({ now: () => now, ...(pg ? { pg } : {}) });
  h = harness;
  await harness.stores.settings.put(PRIVACY_SETTINGS_KEY, { ...DEFAULT_PRIVACY_SETTINGS, ...days });
  return {
    harness,
    job: harness.admin.retention,
    later: (days: number) => (now = START + days * DAY),
    player: (sub: string, daysAgo: number) =>
      harness.stores.players.upsertFromGoogle(
        { sub, email: `${sub}@school.edu`, name: sub, domain: 'school.edu' },
        new Date(START - daysAgo * DAY),
      ),
  };
}

const brief = (id: string, daysAgo: number): ItemRecord => ({
  challengeId: id,
  questionId: 1,
  questionVersion: 1,
  rewardKey: 'brief:plan',
  tier: 1,
  rcsbe: 'B',
  bloom: 'create',
  marks: 6,
  topics: [],
  outcome: 'submitted',
  runs: 0,
  submits: 1,
  wrongSubmits: 0,
  hintsPaid: 0,
  secondsOpen: 1,
  tutorial: false,
  issuedAt: 0,
  finishedAt: START - daysAgo * DAY,
  brief: { text: 'Goal: x', sql: 'SELECT 1', rubric: [{ criterion: 'Goal', marks: 2 }] },
});

describe('privacy retention (21.4)', () => {
  it.skipIf(!TEST_DATABASE_URL)(
    'deletes students not seen for the set time, with what is keyed to them, and keeps the rest',
    async () => {
      const { harness, job, player } = await setup({ inactiveAccountDays: 365 }, true);
      const old = await player('old', 400);
      const recent = await player('recent', 30);
      const cls = await harness.stores.classes.create(classInputSchema.parse({ name: 'C' }), null);
      await harness.stores.classes.addMember(cls.id, old.id);
      await harness.stores.classes.addMember(cls.id, recent.id);
      await harness.stores.profiles.add(old.id, [{ kind: 'all' }], emptyTotals());

      expect(await job.run()).toEqual({ accounts: 1, classes: 0, briefs: 0 });
      expect(await harness.stores.players.findById(old.id)).toBeUndefined();
      expect(await harness.stores.players.findById(recent.id)).toBeDefined();
      expect((await harness.stores.classes.members(cls.id)).map((m) => m.playerId)).toEqual([
        recent.id,
      ]);
      expect(await job.run()).toEqual({ accounts: 0, classes: 0, briefs: 0 });
    },
  );

  it('deletes archived classes after their time, never live ones', async () => {
    const { harness, job, later } = await setup({ archivedClassDays: 180 });
    const make = (name: string) =>
      harness.stores.classes.create(classInputSchema.parse({ name }), null);
    const live = await make('live');
    const archived = await make('archived');
    await harness.stores.classes.archive(archived.id); // archived just now
    expect((await job.run()).classes).toBe(0);
    expect(await harness.stores.classes.get(archived.id)).toBeDefined();
    later(200); // 200 days on
    expect((await job.run()).classes).toBe(1);
    expect(await harness.stores.classes.get(archived.id)).toBeUndefined();
    expect(await harness.stores.classes.get(live.id)).toBeDefined();
  });

  it('deletes old briefs, keeps newer ones, and a setting of 0 keeps everything', async () => {
    const { harness, job } = await setup({ briefDays: 730 });
    await harness.stores.briefs.add(brief('old', 800));
    await harness.stores.briefs.add(brief('new', 100));
    expect((await job.run()).briefs).toBe(1);
    expect((await harness.stores.briefs.list({ status: 'all' })).map((b) => b.id)).toEqual(['new']);

    await harness.stores.settings.put(PRIVACY_SETTINGS_KEY, {
      ...DEFAULT_PRIVACY_SETTINGS,
      briefDays: 0,
      inactiveAccountDays: 0,
      archivedClassDays: 0,
    });
    await harness.stores.briefs.add(brief('ancient', 5000));
    expect(await job.run()).toEqual({ accounts: 0, classes: 0, briefs: 0 });
  });

  it('writes one audit entry with counts and no names', async () => {
    const { harness, job, player } = await setup({ inactiveAccountDays: 365 });
    await player('gone', 500);
    await job.run();
    await harness.admin.settled();
    const entries = await harness.stores.audit.list({ entity: 'retention' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actor: 'retention job', detail: { accounts: 1 } });
    expect(JSON.stringify(entries)).not.toContain('gone@school.edu');
  });
});
