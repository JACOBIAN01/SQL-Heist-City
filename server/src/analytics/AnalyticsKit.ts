import type {
  AnalyticsSettings,
  LeaderboardMessage,
  ProfileMessage,
  ProgressionSettings,
  StorySettings,
} from '@heist/shared';
import { DEFAULT_PROGRESSION_SETTINGS, DEFAULT_STORY_SETTINGS } from '@heist/shared';
import { PgStoryStore } from '../progress/StoryStore';
import { PgGhostStore } from '../progress/GhostStore';
import { PgLeaderboardStore } from '../progress/LeaderboardStore';
import { OptimisationSink } from './OptimisationSink';
import { PgProgressStore } from '../progress/ProgressStore';
import { ProgressBinding } from '../progress/ProgressBinding';
import { PgLoadoutStore } from '../progress/LoadoutStore';
import { PgUpgradeStore } from '../progress/UpgradeStore';
import { PgCollectionStore } from '../progress/CollectionStore';
import { PgContractStore } from '../progress/ContractStore';
import { LeagueService } from '../progress/LeagueService';
import { PgClassResults } from '../classes/ClassResults';
import { PgPlayerRepository } from '../players/PlayerRepository';
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
  private deliverBoard: (accountId: number, message: LeaderboardMessage) => void = () => {};

  constructor(
    db: PgDatabase,
    settings: () => AnalyticsSettings,
    private readonly log: (message: string, err: unknown) => void = (m, e) => console.error(m, e),
    progression: () => ProgressionSettings = () => DEFAULT_PROGRESSION_SETTINGS,
    story: () => StorySettings = () => DEFAULT_STORY_SETTINGS,
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
      contractStore: new PgContractStore(db),
      collectionStore: new PgCollectionStore(db),
      upgradeStore: new PgUpgradeStore(db),
      storyStore: new PgStoryStore(db),
      ghostStore: new PgGhostStore(db),
      story,
      league: new LeagueService(
        new PgClassResults(db),
        attempts,
        progression,
        async (id) => (await new PgPlayerRepository(db).findById(id))?.displayName,
      ),
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
    const board = new OptimisationSink(
      new PgLeaderboardStore(db),
      async (id) => (await new PgPlayerRepository(db).findById(id))?.displayName,
      (accountId, message) => this.deliverBoard(accountId, message),
      (message, err) => this.log(message, err),
    );
    this.sink = new FanOutSink([this.recorder, this.aggregator, briefs, this.progress.sink, board]);
  }

  /** Send profiles to this match's students, and give each one theirs on joining. */
  bind(match: Match): void {
    this.deliver = (accountId, message) => match.sendProfile(accountId, message);
    this.deliverBoard = (accountId, message) => {
      for (const p of match.playersOfAccount(accountId)) match.sendJson(p, message);
    };
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
    await this.progress.contracts.settled();
    await this.recorder.flush();
  }
}
