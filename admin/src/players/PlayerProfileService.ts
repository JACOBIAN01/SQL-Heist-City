import {
  activeSeason,
  axisScores,
  dayOf,
  progressView,
  seasonView,
  skillTree,
  streakOn,
  validChoice,
  wardrobe,
  type AnalyticsSettings,
  type PlayerProfilePage,
  type ProgressionSettings,
  type TopicMarks,
} from '@heist/shared';
import type { AttemptStore, ProfileStore } from '@heist/server/analytics/AttemptStore';
import type { ClassResultRepository } from '@heist/server/classes/ClassResults';
import type { ContractStore } from '@heist/server/progress/ContractStore';
import type { LoadoutStore } from '@heist/server/progress/LoadoutStore';
import type { ProgressStore } from '@heist/server/progress/ProgressStore';
import type { Player } from '@heist/server/players/PlayerRepository';

export interface ProfileDeps {
  readonly progress: ProgressStore;
  readonly loadout: LoadoutStore;
  readonly contracts: ContractStore;
  readonly attempts: AttemptStore;
  readonly profiles: ProfileStore;
  readonly results: ClassResultRepository;
  readonly progression: () => Promise<ProgressionSettings>;
  readonly analytics: () => Promise<AnalyticsSettings>;
  readonly now?: () => number;
}

/** How many past rounds the page lists. */
const HISTORY = 20;

/**
 * Builds a student's profile page from the records the game already keeps (Phase 26.9). It
 * computes rank, skills and the wardrobe the same way the match does, from the same functions.
 */
export class PlayerProfileService {
  constructor(private readonly deps: ProfileDeps) {}

  async build(player: Player): Promise<PlayerProfilePage> {
    const [settings, analytics] = await Promise.all([
      this.deps.progression(),
      this.deps.analytics(),
    ]);
    const today = dayOf((this.deps.now ?? Date.now)());
    const [stored, items, totals, loadout, streak, seasonXp, history] = await Promise.all([
      this.deps.progress.get(player.id),
      this.deps.attempts.itemsOf(player.id),
      this.deps.profiles.load(player.id, { kind: 'all' }),
      this.deps.loadout.get(player.id),
      this.deps.contracts.getStreak(player.id),
      this.deps.progress.seasonXp(player.id),
      this.deps.results.recentForPlayer(player.id, HISTORY),
    ]);

    // Topic marks as the match counts them: counted questions outside pre/post tests.
    const topics = new Map<string, TopicMarks>();
    for (const item of items) {
      if (!item.counted || item.assessment) continue;
      for (const topic of item.topics) {
        const t = topics.get(topic) ?? { earned: 0, available: 0, items: 0 };
        topics.set(topic, {
          earned: t.earned + item.earned,
          available: t.available + item.available,
          items: t.items + 1,
        });
      }
    }
    const progress = progressView(stored.learningXp, stored.playXp, settings);
    const skills = skillTree(topics, settings);
    const cosmetics = wardrobe(progress, skills, settings, seasonXp);
    const season = activeSeason(settings, today);
    return {
      name: player.displayName,
      progress,
      skills,
      mastery: {
        rcsbe: axisScores(totals, 'rcsbe', analytics),
        bloom: axisScores(totals, 'bloom', analytics),
      },
      streakDays: streakOn(streak, today),
      ...(season ? { season: seasonView(season, seasonXp[season.id] ?? 0, today, settings) } : {}),
      wardrobe: { items: cosmetics, choice: validChoice(loadout, cosmetics) },
      history: history.map(({ round, standing }) => ({
        classId: round.classId,
        round: round.number,
        endedAt: round.endedAt,
        rank: standing.rank,
        players: round.players,
        banked: standing.banked,
        kills: standing.kills,
      })),
    };
  }
}
