import {
  BLOOM_LEVELS,
  RCSBE_DIMENSIONS,
  emptyTotals,
  scoreItem,
  type AnalyticsSettings,
  type ItemRecord,
  type ItemScore,
  type ProfileTotals,
  type BloomLevel,
  type RcsbeDimension,
} from '@heist/shared';
import type { PgDatabase } from '../pg/PgDatabase';
import type { AttemptEvent, AttemptWho } from './AttemptSink';

export interface StoredItem extends ItemRecord, ItemScore {}

export type ProfileScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'class'; readonly classId: number }
  | { readonly kind: 'round'; readonly classId: number; readonly round: number }
  /** A class's pre or post assessment: kept apart so the gain between them is clean. */
  | { readonly kind: 'assess'; readonly classId: number; readonly which: 'pre' | 'post' };

// Pattern: Repository — Why: the live match writes the learning record, the admin reads it for
// dashboards and exports; both use this contract (PostgreSQL in production, memory in tests).
export interface AttemptStore {
  writeBatch(
    events: readonly AttemptEvent[],
    items: readonly { item: ItemRecord; who: AttemptWho }[],
    settings: AnalyticsSettings,
  ): Promise<void>;
  /** A student's finished items, oldest first. */
  itemsOf(accountId: number, options?: { classId?: number }): Promise<StoredItem[]>;
  /** A class's finished items. */
  itemsOfClass(classId: number): Promise<StoredItem[]>;
  eventsOf(accountId: number): Promise<AttemptEvent[]>;
  /** Deletes raw events and finished items older than the given times (ms since epoch); returns how many of each. */
  prune(before: { events?: number; items?: number }): Promise<{ events: number; items: number }>;
  /** Sets a finished item's score after the fact (a teacher marked an open brief). */
  rescore(challengeId: string, score: ItemScore): Promise<void>;
  /** Question ids a student has already finished in a class's assessment (one go per question). */
  assessed(accountId: number, classId: number, which: 'pre' | 'post'): Promise<Set<number>>;
}

export interface ProfileStore {
  /** The stored totals of a student in a scope (empty when none). */
  load(accountId: number, scope: ProfileScope): Promise<ProfileTotals>;
  /** Adds to the stored totals (additive: concurrent writers do not overwrite each other). */
  add(accountId: number, scopes: readonly ProfileScope[], delta: ProfileTotals): Promise<void>;
  /** A student's totals for each round of a class, oldest first (the trend). */
  loadRounds(
    accountId: number,
    classId: number,
  ): Promise<{ round: number; totals: ProfileTotals }[]>;
  /** Everyone's totals in a class scope, for the teacher's grid. */
  loadClass(
    classId: number,
    scope?: 'class' | 'pre' | 'post',
  ): Promise<{ accountId: number; totals: ProfileTotals }[]>;
}

const scopeKey = (s: ProfileScope) =>
  s.kind === 'all'
    ? { scope: 'all', classId: 0, round: 0 }
    : s.kind === 'class'
      ? { scope: 'class', classId: s.classId, round: 0 }
      : s.kind === 'assess'
        ? { scope: s.which, classId: s.classId, round: 0 }
        : { scope: 'round', classId: s.classId, round: s.round };

export class InMemoryAttemptStore implements AttemptStore {
  readonly events: AttemptEvent[] = [];
  private readonly items: StoredItem[] = [];

  async writeBatch(
    events: readonly AttemptEvent[],
    items: readonly { item: ItemRecord; who: AttemptWho }[],
    settings: AnalyticsSettings,
  ) {
    this.events.push(...events);
    for (const { item } of items) this.items.push({ ...item, ...scoreItem(item, settings) });
  }

  async itemsOf(accountId: number, options: { classId?: number } = {}) {
    return this.items
      .filter(
        (i) =>
          i.accountId === accountId &&
          (options.classId === undefined || i.classId === options.classId),
      )
      .sort((a, b) => a.finishedAt - b.finishedAt);
  }

  async itemsOfClass(classId: number) {
    return this.items
      .filter((i) => i.classId === classId)
      .sort((a, b) => a.finishedAt - b.finishedAt);
  }

  async eventsOf(accountId: number) {
    return this.events.filter((e) => e.who.accountId === accountId);
  }

  async rescore(challengeId: string, score: ItemScore) {
    const i = this.items.findIndex((x) => x.challengeId === challengeId);
    if (i >= 0) this.items[i] = { ...(this.items[i] as StoredItem), ...score };
  }

  async assessed(accountId: number, classId: number, which: 'pre' | 'post') {
    return new Set(
      this.items
        .filter((i) => i.accountId === accountId && i.classId === classId && i.assessment === which)
        .map((i) => i.questionId),
    );
  }

  async prune(before: { events?: number; items?: number }) {
    const events =
      before.events === undefined
        ? 0
        : this.removeWhere(this.events, (e) => e.at < (before.events as number));
    const items =
      before.items === undefined
        ? 0
        : this.removeWhere(this.items, (i) => i.finishedAt < (before.items as number));
    return { events, items };
  }

  private removeWhere<T>(list: T[], gone: (x: T) => boolean): number {
    let removed = 0;
    for (let i = list.length - 1; i >= 0; i--)
      if (gone(list[i] as T)) {
        list.splice(i, 1);
        removed++;
      }
    return removed;
  }
}

export class InMemoryProfileStore implements ProfileStore {
  private readonly rows = new Map<string, ProfileTotals>();

  private key(accountId: number, scope: ProfileScope) {
    const k = scopeKey(scope);
    return `${accountId}|${k.scope}|${k.classId}|${k.round}`;
  }

  async load(accountId: number, scope: ProfileScope) {
    return this.rows.get(this.key(accountId, scope)) ?? emptyTotals();
  }

  async add(accountId: number, scopes: readonly ProfileScope[], delta: ProfileTotals) {
    for (const scope of scopes) {
      const key = this.key(accountId, scope);
      this.rows.set(key, addTotals(this.rows.get(key) ?? emptyTotals(), delta));
    }
  }

  async loadRounds(accountId: number, classId: number) {
    const out: { round: number; totals: ProfileTotals }[] = [];
    for (const [key, totals] of this.rows) {
      const [account, scope, cid, round] = key.split('|');
      if (scope === 'round' && Number(account) === accountId && Number(cid) === classId)
        out.push({ round: Number(round), totals });
    }
    return out.sort((a, b) => a.round - b.round);
  }

  async loadClass(classId: number, wanted: 'class' | 'pre' | 'post' = 'class') {
    const out: { accountId: number; totals: ProfileTotals }[] = [];
    for (const [key, totals] of this.rows) {
      const [account, scope, cid] = key.split('|');
      if (scope === wanted && Number(cid) === classId)
        out.push({ accountId: Number(account), totals });
    }
    return out;
  }
}

function addTotals(a: ProfileTotals, b: ProfileTotals): ProfileTotals {
  const plus = (x: { earned: number; available: number; items: number }, y: typeof x) => ({
    earned: Math.round((x.earned + y.earned) * 100) / 100,
    available: Math.round((x.available + y.available) * 100) / 100,
    items: x.items + y.items,
  });
  return {
    rcsbe: Object.fromEntries(
      RCSBE_DIMENSIONS.map((d) => [d, plus(a.rcsbe[d], b.rcsbe[d])]),
    ) as ProfileTotals['rcsbe'],
    bloom: Object.fromEntries(
      BLOOM_LEVELS.map((l) => [l, plus(a.bloom[l], b.bloom[l])]),
    ) as ProfileTotals['bloom'],
  };
}

interface TotalRow {
  player_id?: string;
  lens: 'rcsbe' | 'bloom';
  dimension: string;
  earned: string;
  available: string;
  items: number;
  [column: string]: unknown;
}

function totalsFromRows(rows: readonly TotalRow[]): ProfileTotals {
  const base = emptyTotals();
  const rcsbe = { ...base.rcsbe } as Record<RcsbeDimension, ProfileTotals['rcsbe'][RcsbeDimension]>;
  const bloom = { ...base.bloom } as Record<BloomLevel, ProfileTotals['bloom'][BloomLevel]>;
  for (const r of rows) {
    const tally = { earned: Number(r.earned), available: Number(r.available), items: r.items };
    if (r.lens === 'rcsbe') rcsbe[r.dimension as RcsbeDimension] = tally;
    else bloom[r.dimension as BloomLevel] = tally;
  }
  return { rcsbe, bloom };
}

export class PgProfileStore implements ProfileStore {
  constructor(private readonly db: PgDatabase) {}

  async load(accountId: number, scope: ProfileScope) {
    const k = scopeKey(scope);
    const rows = await this.db.query<TotalRow>(
      `SELECT lens, dimension, earned, available, items FROM profile_totals
       WHERE player_id = $1 AND scope = $2 AND class_id = $3 AND round = $4`,
      [accountId, k.scope, k.classId, k.round],
    );
    return totalsFromRows(rows);
  }

  async add(accountId: number, scopes: readonly ProfileScope[], delta: ProfileTotals) {
    const rows: [string, string, number, number, number][] = [];
    for (const d of RCSBE_DIMENSIONS)
      rows.push([
        'rcsbe',
        d,
        delta.rcsbe[d].earned,
        delta.rcsbe[d].available,
        delta.rcsbe[d].items,
      ]);
    for (const l of BLOOM_LEVELS)
      rows.push([
        'bloom',
        l,
        delta.bloom[l].earned,
        delta.bloom[l].available,
        delta.bloom[l].items,
      ]);
    const changed = rows.filter((r) => r[4] > 0 || r[3] > 0);
    if (changed.length === 0) return;
    await this.db.tx(async (tx) => {
      for (const scope of scopes) {
        const k = scopeKey(scope);
        for (const [lens, dimension, earned, available, items] of changed) {
          await tx.query(
            `INSERT INTO profile_totals (player_id, scope, class_id, round, lens, dimension, earned, available, items)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (player_id, scope, class_id, round, lens, dimension) DO UPDATE SET
               earned = profile_totals.earned + excluded.earned,
               available = profile_totals.available + excluded.available,
               items = profile_totals.items + excluded.items`,
            [accountId, k.scope, k.classId, k.round, lens, dimension, earned, available, items],
          );
        }
      }
    });
  }

  async loadRounds(accountId: number, classId: number) {
    const rows = await this.db.query<TotalRow & { round: number }>(
      `SELECT round, lens, dimension, earned, available, items FROM profile_totals
       WHERE player_id = $1 AND scope = 'round' AND class_id = $2 ORDER BY round`,
      [accountId, classId],
    );
    const byRound = new Map<number, TotalRow[]>();
    for (const r of rows) byRound.set(r.round, [...(byRound.get(r.round) ?? []), r]);
    return [...byRound].map(([round, list]) => ({ round, totals: totalsFromRows(list) }));
  }

  async loadClass(classId: number, scope: 'class' | 'pre' | 'post' = 'class') {
    const rows = await this.db.query<TotalRow>(
      `SELECT player_id, lens, dimension, earned, available, items FROM profile_totals
       WHERE scope = $2 AND class_id = $1 ORDER BY player_id`,
      [classId, scope],
    );
    const byPlayer = new Map<number, TotalRow[]>();
    for (const r of rows) {
      const id = Number(r.player_id);
      byPlayer.set(id, [...(byPlayer.get(id) ?? []), r]);
    }
    return [...byPlayer].map(([accountId, list]) => ({ accountId, totals: totalsFromRows(list) }));
  }
}

interface ItemRow {
  challenge_id: string;
  player_id: string | null;
  class_id: string | null;
  round: number | null;
  question_id: string;
  question_version: number;
  reward_key: string;
  tier: number;
  rcsbe: RcsbeDimension;
  bloom: BloomLevel;
  marks: number;
  topics: string[];
  outcome: ItemRecord['outcome'];
  runs: number;
  submits: number;
  wrong_submits: number;
  hints_paid: number;
  seconds_open: string;
  tutorial: boolean;
  counted: boolean;
  available: string;
  earned: string;
  issued_at: Date;
  finished_at: Date;
  assessment: 'pre' | 'post' | null;
  [column: string]: unknown;
}

const toItem = (r: ItemRow): StoredItem => ({
  challengeId: r.challenge_id,
  ...(r.player_id === null ? {} : { accountId: Number(r.player_id) }),
  ...(r.class_id === null ? {} : { classId: Number(r.class_id) }),
  ...(r.round === null ? {} : { round: r.round }),
  questionId: Number(r.question_id),
  questionVersion: r.question_version,
  rewardKey: r.reward_key,
  tier: r.tier,
  rcsbe: r.rcsbe,
  bloom: r.bloom,
  marks: r.marks,
  topics: r.topics,
  outcome: r.outcome,
  runs: r.runs,
  submits: r.submits,
  wrongSubmits: r.wrong_submits,
  hintsPaid: r.hints_paid,
  secondsOpen: Number(r.seconds_open),
  tutorial: r.tutorial,
  issuedAt: r.issued_at.getTime(),
  finishedAt: r.finished_at.getTime(),
  ...(r.assessment === null ? {} : { assessment: r.assessment }),
  counted: r.counted,
  available: Number(r.available),
  earned: Number(r.earned),
});

export class PgAttemptStore implements AttemptStore {
  constructor(private readonly db: PgDatabase) {}

  async writeBatch(
    events: readonly AttemptEvent[],
    items: readonly { item: ItemRecord; who: AttemptWho }[],
    settings: AnalyticsSettings,
  ) {
    if (events.length === 0 && items.length === 0) return;
    await this.db.tx(async (tx) => {
      for (const e of events)
        await tx.query(
          `INSERT INTO attempt_events (at, player_id, class_id, challenge_id, question_id, reward_key, kind, detail)
           VALUES ($1, (SELECT id FROM players WHERE id = $2), (SELECT id FROM classes WHERE id = $3), $4, $5, $6, $7, $8)`,
          [
            new Date(e.at),
            e.who.accountId ?? null,
            e.who.classId ?? null,
            e.challengeId,
            e.questionId,
            e.rewardKey,
            e.kind,
            e.detail ? JSON.stringify(e.detail) : null,
          ],
        );
      for (const { item } of items) {
        const s = scoreItem(item, settings);
        await tx.query(
          `INSERT INTO attempt_items (challenge_id, player_id, class_id, round, question_id, question_version, reward_key,
             tier, rcsbe, bloom, marks, topics, outcome, runs, submits, wrong_submits, hints_paid, seconds_open, tutorial,
             counted, available, earned, issued_at, finished_at, assessment)
           VALUES ($1, (SELECT id FROM players WHERE id = $2), (SELECT id FROM classes WHERE id = $3), $4, $5, $6, $7,
             $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
           ON CONFLICT (challenge_id) DO NOTHING`,
          [
            item.challengeId,
            item.accountId ?? null,
            item.classId ?? null,
            item.round ?? null,
            item.questionId,
            item.questionVersion,
            item.rewardKey,
            item.tier,
            item.rcsbe,
            item.bloom,
            item.marks,
            JSON.stringify(item.topics),
            item.outcome,
            item.runs,
            item.submits,
            item.wrongSubmits,
            item.hintsPaid,
            item.secondsOpen,
            item.tutorial,
            s.counted,
            s.available,
            s.earned,
            new Date(item.issuedAt),
            new Date(item.finishedAt),
            item.assessment ?? null,
          ],
        );
      }
    });
  }

  async itemsOf(accountId: number, options: { classId?: number } = {}) {
    const rows = await this.db.query<ItemRow>(
      `SELECT * FROM attempt_items WHERE player_id = $1 ${options.classId === undefined ? '' : 'AND class_id = $2'}
       ORDER BY finished_at`,
      options.classId === undefined ? [accountId] : [accountId, options.classId],
    );
    return rows.map(toItem);
  }

  async itemsOfClass(classId: number) {
    const rows = await this.db.query<ItemRow>(
      'SELECT * FROM attempt_items WHERE class_id = $1 ORDER BY finished_at',
      [classId],
    );
    return rows.map(toItem);
  }

  async rescore(challengeId: string, score: ItemScore) {
    await this.db.query(
      'UPDATE attempt_items SET counted = $2, available = $3, earned = $4 WHERE challenge_id = $1',
      [challengeId, score.counted, score.available, score.earned],
    );
  }

  async assessed(accountId: number, classId: number, which: 'pre' | 'post') {
    const rows = await this.db.query<{ question_id: string }>(
      'SELECT question_id FROM attempt_items WHERE player_id = $1 AND class_id = $2 AND assessment = $3',
      [accountId, classId, which],
    );
    return new Set(rows.map((r) => Number(r.question_id)));
  }

  async prune(before: { events?: number; items?: number }) {
    const events =
      before.events === undefined
        ? []
        : await this.db.query('DELETE FROM attempt_events WHERE at < $1 RETURNING id', [
            new Date(before.events),
          ]);
    const items =
      before.items === undefined
        ? []
        : await this.db.query(
            'DELETE FROM attempt_items WHERE finished_at < $1 RETURNING challenge_id',
            [new Date(before.items)],
          );
    return { events: events.length, items: items.length };
  }

  async eventsOf(accountId: number) {
    const rows = await this.db.query<{
      at: Date;
      player_id: string | null;
      class_id: string | null;
      challenge_id: string;
      question_id: string;
      reward_key: string;
      kind: AttemptEvent['kind'];
      detail: Record<string, unknown> | null;
    }>('SELECT * FROM attempt_events WHERE player_id = $1 ORDER BY at, id', [accountId]);
    return rows.map((r) => ({
      at: r.at.getTime(),
      kind: r.kind,
      challengeId: r.challenge_id,
      who: {
        ...(r.player_id === null ? {} : { accountId: Number(r.player_id) }),
        ...(r.class_id === null ? {} : { classId: Number(r.class_id) }),
      },
      questionId: Number(r.question_id),
      rewardKey: r.reward_key,
      ...(r.detail ? { detail: r.detail } : {}),
    }));
  }
}
