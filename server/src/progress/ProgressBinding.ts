import {
  activeSeason,
  dayOf,
  seasonView,
  skillTree,
  type LookView,
  type ProgressionSettings,
  type SeasonMessage,
  type StorySettings,
  type SkillView,
  type TopicMarks,
} from '@heist/shared';
import { FanOutSink, type AttemptSink } from '../analytics/AttemptSink';
import { ContractKeeper } from './ContractKeeper';
import type { CollectionStore } from './CollectionStore';
import type { UpgradeStore } from './UpgradeStore';
import type { StoryStore } from './StoryStore';
import type { ContractStore } from './ContractStore';
import type { LeagueService } from './LeagueService';
import type { Match } from '../game/Match';
import type { Player } from '../game/Player';
import { LoadoutKeeper, type Wardrobe } from './LoadoutKeeper';
import type { LoadoutStore } from './LoadoutStore';
import { ProgressKeeper } from './ProgressKeeper';
import type { ProgressStore } from './ProgressStore';

export interface ProgressBindingDeps {
  readonly progressStore: ProgressStore;
  readonly loadoutStore: LoadoutStore;
  readonly contractStore: ContractStore;
  readonly collectionStore: CollectionStore;
  readonly upgradeStore: UpgradeStore;
  readonly storyStore: StoryStore;
  /** The story's words and chains (admin-editable). */
  readonly story: () => StorySettings;
  readonly now?: () => number;
  /** The class league; without it no league is sent. */
  readonly league?: LeagueService;
  readonly settings: () => ProgressionSettings;
  /** Topics a student solved before this visit. */
  readonly solvedTopics: (accountId: number) => Promise<ReadonlySet<string>>;
  /** A connected student's live topic marks (undefined until their profile has loaded). */
  readonly topicsOf: (accountId: number) => ReadonlyMap<string, TopicMarks> | undefined;
  readonly log: (message: string, err: unknown) => void;
}

/**
 * Everything a match does with a student's progress (Phase 26): XP and rank, the skill tree, and
 * what they wear. It listens to the match; the match knows nothing about progress.
 *
 * Pattern: Facade — Why: the learning-record kit asks for one thing ("bind this match to
 * progress") instead of knowing the keepers, their messages and when each is sent.
 */
export class ProgressBinding {
  readonly keeper: ProgressKeeper;
  readonly loadout: LoadoutKeeper;
  readonly contracts: ContractKeeper;
  private match: Match | undefined;
  /** How everyone in the match looks, by player id. */
  private readonly looks = new Map<number, LookView>();
  /** Players the table of looks has been sent about. */
  private readonly told = new Set<number>();

  constructor(private readonly deps: ProgressBindingDeps) {
    this.keeper = new ProgressKeeper(
      deps.progressStore,
      deps.settings,
      deps.solvedTopics,
      (accountId, message) => {
        this.match?.sendProgress(accountId, message);
        void this.sendSeason(accountId);
        this.refreshWardrobe(accountId);
      },
      (err) => deps.log('could not save XP', err),
      deps.now ?? Date.now,
    );
    this.contracts = new ContractKeeper(
      deps.contractStore,
      deps.settings,
      deps.now ?? Date.now,
      (accountId, xp) => this.keeper.bonus(accountId, xp, 'contract'),
      (accountId, message) => {
        if (this.match)
          for (const p of this.match.playersOfAccount(accountId)) this.match.sendJson(p, message);
      },
      (err) => deps.log('could not update contracts', err),
    );
    this.loadout = new LoadoutKeeper(
      deps.loadoutStore,
      deps.settings,
      async (accountId) => (await this.keeper.messageOf(accountId)).progress,
      (accountId) => this.skillsOf(accountId),
      (accountId) => deps.progressStore.seasonXp(accountId),
    );
  }

  /** The XP listener for the attempt sinks. */
  get sink(): AttemptSink {
    return new FanOutSink([this.keeper, this.contracts]);
  }

  /** The current season and the student's place on its free track (no season: an empty message). */
  async seasonMessageOf(accountId: number): Promise<SeasonMessage> {
    const settings = this.deps.settings();
    const today = dayOf((this.deps.now ?? Date.now)());
    const season = activeSeason(settings, today);
    if (!season) return { t: 'season' };
    const xp = (await this.deps.progressStore.seasonXp(accountId))[season.id] ?? 0;
    return { t: 'season', season: seasonView(season, xp, today, settings) };
  }

  private async sendSeason(accountId: number): Promise<void> {
    try {
      const message = await this.seasonMessageOf(accountId);
      for (const p of this.match?.playersOfAccount(accountId) ?? [])
        this.match?.sendJson(p, message);
    } catch (err) {
      this.deps.log('could not send the season', err);
    }
  }

  skillsOf(accountId: number): SkillView[] {
    return skillTree(this.deps.topicsOf(accountId) ?? new Map(), this.deps.settings());
  }

  /** The student's marks changed (a question counted): their tree, and what it unlocks, may have too. */
  topicsChanged(accountId: number): void {
    this.match?.sendSkills(accountId, { t: 'skills', skills: this.skillsOf(accountId) });
    this.refreshWardrobe(accountId);
  }

  bind(match: Match): void {
    this.match = match;
    match.heist.collectibles.bindStore(this.deps.collectionStore);
    match.heist.discovery.bindStore(this.deps.collectionStore);
    match.heist.upgrades.bindStore(this.deps.upgradeStore);
    match.heist.story.bindStore(this.deps.storyStore);
    match.heist.story.bindSettings(this.deps.story);
    match.heist.events.subscribe((event) => {
      // A finished heist teaches something too (Phase 31.4): mastery XP, over and above the question XP.
      // Finishing a bank's story chain pays XP too.
      if (event.type === 'chain_complete' && event.player.accountId !== undefined)
        void this.keeper.bonus(event.player.accountId, event.xp, 'story');
      if (event.type === 'heist_complete' && event.player.accountId !== undefined)
        void this.keeper.bonus(event.player.accountId, event.mastery, 'heist');
      if (event.type === 'round_end') {
        this.keeper.roundEnded(event.result);
        // The round's cash is saved a moment after it ends; the table is sent a little later.
        setTimeout(() => this.sendLeague(match), 2000).unref();
      }
    });
    match.heist.onLook = (player, message) => {
      if (player.accountId === undefined) return;
      const accountId = player.accountId;
      this.inOrder(accountId, async () =>
        this.show(match, player, await this.loadout.choose(accountId, message.slot, message.id)),
      );
    };
  }

  /**
   * Wardrobe work for one student runs one at a time, in the order asked: a refresh that read the
   * old choice must never be sent after a change that came later.
   */
  private readonly chains = new Map<number, Promise<void>>();

  private inOrder(accountId: number, work: () => Promise<void>): void {
    const next = (this.chains.get(accountId) ?? Promise.resolve())
      .then(work)
      .catch((err: unknown) => this.deps.log('could not update a wardrobe', err));
    this.chains.set(accountId, next);
  }

  /** A signed-in student joined (their profile is loaded): tell them where they stand. */
  async playerJoined(match: Match, player: Player): Promise<void> {
    const accountId = player.accountId;
    if (accountId === undefined) return;
    try {
      match.sendProgress(accountId, await this.keeper.messageOf(accountId));
      match.sendSkills(accountId, { t: 'skills', skills: this.skillsOf(accountId) });
      for (const p of match.playersOfAccount(accountId))
        match.sendJson(p, await this.contracts.messageOf(accountId));
      void this.sendLeague(match, player);
      void this.sendSeason(accountId);
      await new Promise<void>((resolve) =>
        this.inOrder(accountId, async () => {
          try {
            this.show(match, player, await this.loadout.wardrobeOf(accountId));
          } finally {
            resolve();
          }
        }),
      );
    } catch (err) {
      this.deps.log('could not load progress', err);
    }
  }

  /** The class league, to one player or to everyone signed in (a class room only). */
  async sendLeague(match: Match, only?: Player): Promise<void> {
    const classId = match.classInfo?.classId;
    if (!this.deps.league || classId === undefined) return;
    try {
      const league = await this.deps.league.table(classId);
      const to = only ? [only] : match.allPlayers().filter((p) => p.accountId !== undefined);
      for (const p of to)
        match.sendJson(p, {
          t: 'league',
          week: league.week,
          rows: league.rows.slice(0, 10).map((r) => ({
            rank: r.rank,
            name: r.name,
            points: r.points,
            learningPoints: r.learningPoints,
            cashPoints: r.cashPoints,
            you: r.playerId === p.accountId,
          })),
        });
    } catch (err) {
      this.deps.log('could not send the league', err);
    }
  }

  playerLeft(match: Match, player: Player): void {
    if (player.accountId !== undefined) this.keeper.forget(player.accountId);
    this.told.delete(player.id);
    if (this.looks.delete(player.id)) this.broadcastLooks(match);
  }

  /** Re-checks what a student can wear after their progress moved, and shows the result. */
  private refreshWardrobe(accountId: number): void {
    const match = this.match;
    if (!match) return;
    for (const player of match.playersOfAccount(accountId))
      this.inOrder(accountId, async () =>
        this.show(match, player, await this.loadout.wardrobeOf(accountId)),
      );
  }

  private show(match: Match, player: Player, w: Wardrobe): void {
    match.sendJson(player, { t: 'wardrobe', items: w.items, choice: w.choice });
    const look = this.loadout.lookOf(w.choice);
    const was = JSON.stringify(this.looks.get(player.id) ?? {});
    this.looks.set(player.id, look);
    // Everyone is told when a look changes (and a newcomer gets the whole table).
    if (was !== JSON.stringify(look) || !this.told.has(player.id)) {
      this.told.add(player.id);
      this.broadcastLooks(match);
    }
  }

  private broadcastLooks(match: Match): void {
    const looks: Record<string, LookView> = {};
    for (const [id, look] of this.looks) looks[String(id)] = look;
    match.broadcastJson({ t: 'looks', looks });
  }
}
