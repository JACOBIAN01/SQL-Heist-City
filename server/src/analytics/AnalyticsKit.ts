import type { AnalyticsSettings, ProfileMessage, ProgressionSettings } from '@heist/shared';
import { DEFAULT_PROGRESSION_SETTINGS } from '@heist/shared';
import { PgProgressStore } from '../progress/ProgressStore';
import { ProgressBinding } from '../progress/ProgressBinding';
import { PgLoadoutStore } from '../progress/LoadoutStore';
import type { PgDatabase } from '../pg/PgDatabase';
import type { Match } from '../game/Match';
import { FanOutSink, type AttemptSink } from './AttemptSink';
import { PgAttemptStore, PgProfileStore } from './AttemptStore';
import { BatchingRecorder, ProfileAggregator } from './ProfileAggregator';
import { BriefSink, PgBriefStore } from './BriefStore';

/**
 * The learning record for one process: saves every attempt in batches and
 * keeps connected students' profiles live. Built once, then bound to the match
 * it serves (the stack that needs the sink is built before the match).
 */
export class AnalyticsKit {
  readonly sink: AttemptSink;
  private readonly recorder: BatchingRecorder;
  private readonly aggregator: ProfileAggregator;
  private deliver: (accountId: number, message: ProfileMessage) => void = () => {};
  private readonly progress: ProgressBinding;

  constructor(
    db: PgDatabase,
    settings: () => AnalyticsSettings,
    private readonly log: (message: string, err: unknown) => void = (m, e) => console.error(m, e),
    progression: () => ProgressionSettings = () => DEFAULT_PROGRESSION_SETTINGS,
  ) {
    const attempts = new PgAttemptStore(db);
    this.recorder = new BatchingRecorder(
      (events, items) => attempts.writeBatch(events, items, settings()),
      (err) => this.log('could not save attempts', err),
    );
    this.aggregator = new ProfileAggregator(
      new PgProfileStore(db),
      settings,
      (accountId, message) => this.deliver(accountId, message),
      (err) => this.log('could not update a profile', err),
      async (accountId) => (await attempts.itemsOf(accountId)).slice(-300),
    );
    const briefs = new BriefSink(new PgBriefStore(db), (err) =>
      this.log('could not save a brief', err),
    );
    this.progress = new ProgressBinding({
      progressStore: new PgProgressStore(db),
      loadoutStore: new PgLoadoutStore(db),
      settings: progression,
      solvedTopics: async (accountId) =>
        new Set(
          (await attempts.itemsOf(accountId))
            .slice(-300)
            .flatMap((i) => (i.outcome === 'solved' ? [...i.topics] : [])),
        ),
      topicsOf: (accountId) => this.aggregator.topicsOf(accountId),
      log: (message, err) => this.log(message, err),
    });
    this.sink = new FanOutSink([this.recorder, this.aggregator, briefs, this.progress.sink]);
  }

  /** Send profiles to this match's students, and give each one theirs on joining. */
  bind(match: Match): void {
    this.deliver = (accountId, message) => match.sendProfile(accountId, message);
    this.aggregator.onTopics((accountId) => this.progress.topicsChanged(accountId));
    this.progress.bind(match);
    match.heist.focusOf = (player) =>
      player.accountId === undefined ? undefined : this.aggregator.focusOf(player.accountId);
    match.heist.skillOf = (player) =>
      player.accountId === undefined ? undefined : this.aggregator.skillOf(player.accountId);
    match.onPlayerJoined((player) => {
      if (player.accountId === undefined) return;
      const accountId = player.accountId;
      this.aggregator
        .profileOf(accountId, match.classInfo?.classId, match.roundNumber)
        .then((message) => {
          match.sendProfile(accountId, message);
          // The tree needs the profile's topic marks, so progress is told after it has loaded.
          return this.progress.playerJoined(match, player);
        })
        .catch((err) => this.log('could not load a profile', err));
    });
    match.onPlayerLeft((player) => {
      if (player.accountId !== undefined) this.aggregator.forget(player.accountId);
      this.progress.playerLeft(match, player);
    });
  }

  /** Save everything that is waiting (shutdown). */
  async flush(): Promise<void> {
    await this.aggregator.settled();
    await this.progress.keeper.settled();
    await this.recorder.flush();
  }
}
