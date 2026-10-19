import {
  addItem,
  axisScores,
  emptyTotals,
  mergeTotals,
  remediation,
  scoreItem,
  type AnalyticsSettings,
  type ItemRecord,
  type ProfileMessage,
  type ProfileScopeView,
  type SkillAdjust,
  skillAdjust,
  type ProfileTotals,
  type TopicMarks,
} from '@heist/shared';
import type { AttemptEvent, AttemptSink, AttemptWho } from './AttemptSink';
import type { ProfileScope, ProfileStore } from './AttemptStore';

/** Both lenses of some totals, scored, with the remediation signal. */
export function scopeView(totals: ProfileTotals, settings: AnalyticsSettings): ProfileScopeView {
  const rcsbe = axisScores(totals, 'rcsbe', settings);
  const bloom = axisScores(totals, 'bloom', settings);
  const focus = remediation(rcsbe);
  return {
    rcsbe,
    bloom,
    ...(focus ? { focus: { lens: 'rcsbe' as const, dimension: focus.dimension } } : {}),
  };
}

interface Live {
  /** Per topic: marks earned and available over counted items, for spaced repetition. */
  topics: Map<string, { earned: number; available: number; items: number }>;
  all: ProfileTotals;
  class: ProfileTotals | undefined;
  round: ProfileTotals | undefined;
  classId: number | undefined;
  round_: number | undefined;
}

/**
 * Keeps every connected student's profile up to date as questions end, and
 * adds what they earned to the stored totals.
 *
 * Pattern: Observer (an AttemptSink) — Why: grading code does not change; the
 * profile is one more listener on "a question ended". Totals are additive, so
 * a live profile always equals a rebuild from the stored items (docs/RCBSE.md §8).
 */
export class ProfileAggregator implements AttemptSink {
  private readonly live = new Map<number, Promise<Live>>();
  /** The same students once their profile has loaded, for answers that cannot wait. */
  private readonly loaded = new Map<number, Live>();
  private readonly writes: Promise<void>[] = [];

  constructor(
    private readonly store: ProfileStore,
    private readonly settings: () => AnalyticsSettings,
    /** Called with the student's new profile after each counted question. */
    private readonly onProfile: (accountId: number, message: ProfileMessage) => void,
    private readonly onError: (err: unknown) => void = () => {},
    /** A student's earlier finished items (most recent), for spaced repetition. */
    private readonly items?: (accountId: number) => Promise<readonly ItemRecord[]>,
  ) {}

  event(_event: AttemptEvent): void {}

  private topicListener: (accountId: number, topics: ReadonlyMap<string, TopicMarks>) => void =
    () => {};

  /** Called with a student's topic marks after each counted question (the skill tree follows them). */
  onTopics(listener: (accountId: number, topics: ReadonlyMap<string, TopicMarks>) => void): void {
    this.topicListener = listener;
  }

  /** A student's topic marks once their profile has loaded. */
  topicsOf(accountId: number): ReadonlyMap<string, TopicMarks> | undefined {
    return this.loaded.get(accountId)?.topics;
  }

  /** The student's weakest topics (with enough evidence), lowest first: where questions are drawn from now and then. */
  focusOf(accountId: number): readonly string[] | undefined {
    const loaded = this.loaded.get(accountId);
    if (!loaded) return undefined;
    const settings = this.settings();
    return [...loaded.topics]
      .filter(([, t]) => t.items >= settings.minItems && t.available > 0)
      .map(([topic, t]) => ({ topic, score: t.earned / t.available }))
      .sort((a, b) => a.score - b.score || a.topic.localeCompare(b.topic))
      .slice(0, settings.spaced.topics)
      .filter((t) => t.score < 1)
      .map((t) => t.topic);
  }

  /** How to ease this student's questions, from their live all-time profile (none until it is loaded). */
  skillOf(accountId: number): SkillAdjust | undefined {
    const loaded = this.loaded.get(accountId);
    return loaded ? skillAdjust(loaded.all, this.settings()) : undefined;
  }

  /** A student's profile as of now, for sending when they join. */
  async profileOf(accountId: number, classId?: number, round?: number): Promise<ProfileMessage> {
    const live = await this.ensure(accountId, classId, round);
    return this.messageOf(live);
  }

  item(item: ItemRecord, who: AttemptWho): void {
    if (who.accountId === undefined) return;
    const accountId = who.accountId;
    const settings = this.settings();
    if (!scoreItem(item, settings).counted) return;
    const work = this.apply(accountId, item, who, settings).catch(this.onError);
    this.writes.push(work);
    void work.then(() => this.writes.splice(this.writes.indexOf(work), 1));
  }

  /** Waits for every update in flight (shutdown, tests). */
  async settled(): Promise<void> {
    await Promise.all([...this.writes]);
  }

  private async apply(
    accountId: number,
    item: ItemRecord,
    who: AttemptWho,
    settings: AnalyticsSettings,
  ): Promise<void> {
    const live = await this.ensure(accountId, who.classId, who.round);
    const delta = addItem(emptyTotals(), item, settings);
    if (who.assessment !== undefined) {
      // An assessment answer counts in its own scope only, so the gain between pre and post is clean.
      if (who.classId !== undefined)
        await this.store.add(
          accountId,
          [{ kind: 'assess', classId: who.classId, which: who.assessment }],
          delta,
        );
      return;
    }
    live.all = mergeTotals(live.all, delta);
    const score = scoreItem(item, settings);
    for (const topic of item.topics) {
      const t = live.topics.get(topic) ?? { earned: 0, available: 0, items: 0 };
      t.earned += score.earned;
      t.available += score.available;
      t.items += 1;
      live.topics.set(topic, t);
    }
    this.topicListener(accountId, live.topics);
    if (who.classId !== undefined) live.class = mergeTotals(live.class ?? emptyTotals(), delta);
    if (who.round !== undefined) live.round = mergeTotals(live.round ?? emptyTotals(), delta);
    const scopes: ProfileScope[] = [{ kind: 'all' }];
    if (who.classId !== undefined) {
      scopes.push({ kind: 'class', classId: who.classId });
      if (who.round !== undefined)
        scopes.push({ kind: 'round', classId: who.classId, round: who.round });
    }
    // Memory first (the student sees it at once), then the store.
    this.onProfile(accountId, {
      ...this.messageOf(live, settings),
      moved: [
        { lens: 'rcsbe', dimension: item.rcsbe },
        { lens: 'bloom', dimension: item.bloom },
      ],
    });
    await this.store.add(accountId, scopes, delta);
  }

  /** Topic marks from the student's stored items, so what they got wrong in earlier rounds is remembered. */
  private async loadTopics(accountId: number): Promise<Live['topics']> {
    const topics: Live['topics'] = new Map();
    const settings = this.settings();
    for (const stored of (await this.items?.(accountId)) ?? []) {
      const score = scoreItem(stored, settings);
      if (!score.counted) continue;
      for (const topic of stored.topics) {
        const t = topics.get(topic) ?? { earned: 0, available: 0, items: 0 };
        t.earned += score.earned;
        t.available += score.available;
        t.items += 1;
        topics.set(topic, t);
      }
    }
    return topics;
  }

  private ensure(accountId: number, classId?: number, round?: number): Promise<Live> {
    let pending = this.live.get(accountId);
    if (!pending) {
      pending = (async () => ({
        topics: await this.loadTopics(accountId),
        all: await this.store.load(accountId, { kind: 'all' }),
        class:
          classId === undefined
            ? undefined
            : await this.store.load(accountId, { kind: 'class', classId }),
        round:
          classId === undefined || round === undefined
            ? undefined
            : await this.store.load(accountId, { kind: 'round', classId, round }),
        classId,
        round_: round,
      }))();
      this.live.set(accountId, pending);
      pending.then(
        (live) => this.loaded.set(accountId, live),
        () => this.live.delete(accountId),
      );
    }
    return pending.then(async (live) => {
      // A new round starts fresh round totals.
      if (round !== undefined && classId !== undefined && live.round_ !== round) {
        live.round = await this.store.load(accountId, { kind: 'round', classId, round });
        live.round_ = round;
      }
      return live;
    });
  }

  /** Forget a student who left (their totals are stored). */
  forget(accountId: number): void {
    this.live.delete(accountId);
    this.loaded.delete(accountId);
  }

  private messageOf(live: Live, settings: AnalyticsSettings = this.settings()): ProfileMessage {
    return {
      t: 'profile',
      all: scopeView(live.all, settings),
      ...(live.class ? { class: scopeView(live.class, settings) } : {}),
      ...(live.round ? { round: scopeView(live.round, settings) } : {}),
    };
  }
}

/**
 * Writes the learning record in batches, off the game tick: events and items
 * wait in memory and are saved every `everyMs` (or when many pile up).
 */
export class BatchingRecorder implements AttemptSink {
  private events: AttemptEvent[] = [];
  private items: { item: ItemRecord; who: AttemptWho }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly write: (
      events: readonly AttemptEvent[],
      items: readonly { item: ItemRecord; who: AttemptWho }[],
    ) => Promise<void>,
    private readonly onError: (err: unknown) => void = () => {},
    private readonly everyMs = 500,
    private readonly maxPending = 200,
  ) {}

  event(event: AttemptEvent): void {
    this.events.push(event);
    this.schedule();
  }

  item(item: ItemRecord, who: AttemptWho): void {
    this.items.push({ item, who });
    this.schedule();
  }

  /** Saves what is waiting and resolves when every save so far is done. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const events = this.events;
    const items = this.items;
    this.events = [];
    this.items = [];
    if (events.length > 0 || items.length > 0)
      this.inFlight = this.inFlight.then(() => this.write(events, items)).catch(this.onError);
    await this.inFlight;
  }

  private schedule(): void {
    if (this.events.length + this.items.length >= this.maxPending) {
      void this.flush();
      return;
    }
    this.timer ??= setTimeout(() => void this.flush(), this.everyMs);
  }
}
