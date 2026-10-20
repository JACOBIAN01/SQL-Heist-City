import {
  addWeeks,
  leagueTable,
  weekStartOf,
  type LeagueInput,
  type LeagueRow,
  type ProgressionSettings,
} from '@heist/shared';
import type { AttemptStore } from '../analytics/AttemptStore';
import type { ClassResultRepository } from '../classes/ClassResults';

export interface League {
  /** The Monday that starts the week (UTC) and the Monday after it. */
  readonly week: { readonly start: string; readonly end: string };
  readonly rows: LeagueRow[];
}

/**
 * The weekly class league (Phase 26.6): per week, per class, from what was already recorded
 * (cash from finished rounds, marks from counted questions). Nothing new is collected, and nothing
 * is stored: the table is worked out when asked.
 */
export class LeagueService {
  constructor(
    private readonly results: ClassResultRepository,
    private readonly attempts: AttemptStore,
    private readonly settings: () => ProgressionSettings | Promise<ProgressionSettings>,
    /** A student's display name, for those who answered questions but played no round. */
    private readonly nameOf: (playerId: number) => Promise<string | undefined>,
    private readonly now: () => number = Date.now,
  ) {}

  /** The league for the week starting `weekStart` (this week when omitted). */
  async table(classId: number, weekStart: string = weekStartOf(this.now())): Promise<League> {
    const end = addWeeks(weekStart, 1);
    const from = new Date(weekStart);
    const to = new Date(end);
    const people = new Map<number, LeagueInput>();
    for (const t of await this.results.totalsBetween(classId, from, to))
      people.set(t.playerId, {
        playerId: t.playerId,
        name: t.name,
        banked: t.banked,
        rounds: t.rounds,
        earned: 0,
        available: 0,
      });
    for (const item of await this.attempts.itemsOfClass(classId)) {
      // Pre/post tests and the tutorial are not play; unfinished questions earn nothing.
      if (
        item.accountId === undefined ||
        !item.counted ||
        item.tutorial ||
        item.assessment ||
        item.finishedAt < from.getTime() ||
        item.finishedAt >= to.getTime()
      )
        continue;
      const was = people.get(item.accountId) ?? {
        playerId: item.accountId,
        name: (await this.nameOf(item.accountId)) ?? `Student ${item.accountId}`,
        banked: 0,
        rounds: 0,
        earned: 0,
        available: 0,
      };
      people.set(item.accountId, {
        ...was,
        earned: was.earned + item.earned,
        available: was.available + item.available,
      });
    }
    return {
      week: { start: weekStart, end },
      rows: leagueTable([...people.values()], await this.settings()),
    };
  }
}
