import type { AnalyticsSettings, ProfileMessage } from '@heist/shared';
import type { PgDatabase } from '../pg/PgDatabase';
import type { Match } from '../game/Match';
import { FanOutSink, type AttemptSink } from './AttemptSink';
import { PgAttemptStore, PgProfileStore } from './AttemptStore';
import { BatchingRecorder, ProfileAggregator } from './ProfileAggregator';

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

  constructor(
    db: PgDatabase,
    settings: () => AnalyticsSettings,
    private readonly log: (message: string, err: unknown) => void = (m, e) => console.error(m, e),
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
    this.sink = new FanOutSink([this.recorder, this.aggregator]);
  }

  /** Send profiles to this match's students, and give each one theirs on joining. */
  bind(match: Match): void {
    this.deliver = (accountId, message) => match.sendProfile(accountId, message);
    match.heist.focusOf = (player) =>
      player.accountId === undefined ? undefined : this.aggregator.focusOf(player.accountId);
    match.heist.skillOf = (player) =>
      player.accountId === undefined ? undefined : this.aggregator.skillOf(player.accountId);
    match.onPlayerJoined((player) => {
      if (player.accountId === undefined) return;
      const accountId = player.accountId;
      this.aggregator
        .profileOf(accountId, match.classInfo?.classId, match.roundNumber)
        .then((message) => match.sendProfile(accountId, message))
        .catch((err) => this.log('could not load a profile', err));
    });
    match.onPlayerLeft((player) => {
      if (player.accountId !== undefined) this.aggregator.forget(player.accountId);
    });
  }

  /** Save everything that is waiting (shutdown). */
  async flush(): Promise<void> {
    await this.aggregator.settled();
    await this.recorder.flush();
  }
}
