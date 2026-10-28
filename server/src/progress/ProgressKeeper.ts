import {
  activeSeason,
  dayOf,
  learningXp,
  playXp,
  progressView,
  type ItemRecord,
  type ProgressMessage,
  type ProgressionSettings,
} from '@heist/shared';
import type { AttemptEvent, AttemptSink, AttemptWho } from '../analytics/AttemptSink';
import type { RoundResult } from '../heist/HeistEvents';
import type { ProgressStore } from './ProgressStore';

/**
 * Turns what students do into XP (Phase 26.1): a solved question as it ends, a round as it
 * finishes. Mastery pays more than fighting (see `playXp`'s cap). XP only ever goes up.
 *
 * Pattern: Observer (an AttemptSink) — Why: grading and the round code are untouched; XP is one
 * more listener on "a question ended" and "a round ended".
 */
export class ProgressKeeper implements AttemptSink {
  /** One chain per student, so two answers close together are counted in order. */
  private readonly chains = new Map<number, Promise<void>>();
  /** Topics a student has already got right, loaded the first time they earn something. */
  private readonly known = new Map<number, Set<string>>();

  constructor(
    private readonly store: ProgressStore,
    private readonly settings: () => ProgressionSettings,
    /** The topics the student has solved before this visit (from the learning record). */
    private readonly solvedTopics: (accountId: number) => Promise<ReadonlySet<string>>,
    private readonly deliver: (accountId: number, message: ProgressMessage) => void,
    private readonly onError: (err: unknown) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  event(_event: AttemptEvent): void {}

  item(item: ItemRecord, who: AttemptWho): void {
    const accountId = item.accountId ?? who.accountId;
    if (accountId === undefined) return;
    this.enqueue(accountId, async () => {
      if (item.outcome !== 'solved' && item.outcome !== 'answered') return;
      let known = this.known.get(accountId);
      if (!known) {
        known = new Set(await this.solvedTopics(accountId));
        this.known.set(accountId, known);
      }
      const newTopic = item.topics.some((t) => !known.has(t));
      const xp = learningXp(item, this.settings(), newTopic);
      for (const t of item.topics) known.add(t);
      if (xp > 0) await this.award(accountId, { learningXp: xp }, xp, 'solve');
    });
  }

  /** A round finished: everyone signed in who took part earns for it. */
  roundEnded(result: RoundResult): void {
    for (const s of result.standings) {
      if (s.accountId === undefined || s.cheated) continue;
      const xp = playXp(s, this.settings());
      if (xp > 0)
        this.enqueue(s.accountId, () =>
          this.award(s.accountId as number, { playXp: xp }, xp, 'round'),
        );
    }
  }

  /** A student's progress as the client shows it. */
  /** XP that is not for a question or a round (a finished contract), added in order with the rest. */
  bonus(accountId: number, xp: number, why: 'contract' | 'heist' | 'story'): Promise<void> {
    return new Promise((resolve) =>
      this.enqueue(accountId, async () => {
        try {
          if (xp > 0) await this.award(accountId, { learningXp: xp }, xp, why);
        } finally {
          resolve();
        }
      }),
    );
  }

  async messageOf(accountId: number): Promise<ProgressMessage> {
    const stored = await this.store.get(accountId);
    const settings = this.settings();
    return {
      t: 'progress',
      progress: progressView(stored.learningXp, stored.playXp, settings),
      share: settings.share,
    };
  }

  forget(accountId: number): void {
    this.known.delete(accountId);
  }

  /** Resolves when every XP write so far has landed (tests, shutdown). */
  async settled(): Promise<void> {
    await Promise.all([...this.chains.values()]);
  }

  private async award(
    accountId: number,
    delta: { learningXp?: number; playXp?: number },
    amount: number,
    why: 'solve' | 'round' | 'contract' | 'heist' | 'story',
  ): Promise<void> {
    const stored = await this.store.add(accountId, delta);
    // While a season runs, the same XP fills its free track.
    const season = activeSeason(this.settings(), dayOf(this.now()));
    if (season) await this.store.addSeason(accountId, season.id, amount);
    this.deliver(accountId, {
      t: 'progress',
      progress: progressView(stored.learningXp, stored.playXp, this.settings()),
      gained: { amount, why },
    });
  }

  private enqueue(accountId: number, work: () => Promise<void>): void {
    const next = (this.chains.get(accountId) ?? Promise.resolve())
      .then(work)
      .catch((err: unknown) => this.onError(err));
    this.chains.set(accountId, next);
  }
}
