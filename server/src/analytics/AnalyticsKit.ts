import type {
  AnalyticsSettings,
  ProfileMessage,
  ProgressMessage,
  ProgressionSettings,
} from '@heist/shared';
import { DEFAULT_PROGRESSION_SETTINGS, skillTree } from '@heist/shared';
import { PgProgressStore } from '../progress/ProgressStore';
import { ProgressKeeper } from '../progress/ProgressKeeper';
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
  private readonly progress: ProgressKeeper;
  private readonly progression: () => ProgressionSettings;
  private deliverProgress: (accountId: number, message: ProgressMessage) => void = () => {};

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
    this.progression = progression;
    this.progress = new ProgressKeeper(
      new PgProgressStore(db),
      progression,
      async (accountId) =>
        new Set(
          (await attempts.itemsOf(accountId))
            .slice(-300)
            .flatMap((i) => (i.outcome === 'solved' ? [...i.topics] : [])),
        ),
      (accountId, message) => this.deliverProgress(accountId, message),
      (err) => this.log('could not save XP', err),
    );
    this.sink = new FanOutSink([this.recorder, this.aggregator, briefs, this.progress]);
  }

  /** Send profiles to this match's students, and give each one theirs on joining. */
  bind(match: Match): void {
    this.deliver = (accountId, message) => match.sendProfile(accountId, message);
    this.aggregator.onTopics((accountId, topics) =>
      match.sendSkills(accountId, { t: 'skills', skills: skillTree(topics, this.progression()) }),
    );
    this.deliverProgress = (accountId, message) => match.sendProgress(accountId, message);
    match.heist.events.subscribe((event) => {
      if (event.type === 'round_end') this.progress.roundEnded(event.result);
    });
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
          match.sendSkills(accountId, {
            t: 'skills',
            skills: skillTree(this.aggregator.topicsOf(accountId) ?? new Map(), this.progression()),
          });
        })
        .catch((err) => this.log('could not load a profile', err));
      this.progress
        .messageOf(accountId)
        .then((message) => match.sendProgress(accountId, message))
        .catch((err) => this.log('could not load XP', err));
    });
    match.onPlayerLeft((player) => {
      if (player.accountId === undefined) return;
      this.aggregator.forget(player.accountId);
      this.progress.forget(player.accountId);
    });
  }

  /** Save everything that is waiting (shutdown). */
  async flush(): Promise<void> {
    await this.aggregator.settled();
    await this.progress.settled();
    await this.recorder.flush();
  }
}
