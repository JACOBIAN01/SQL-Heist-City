import type { ProgressionSettings } from '../config/progression';
import { daysBetween } from './contracts';

/** What one student did in a class during a week. */
export interface LeagueInput {
  readonly playerId: number;
  readonly name: string;
  /** Cash banked in class rounds. */
  readonly banked: number;
  readonly rounds: number;
  /** Marks earned and marks available on counted questions (no tutorial, no tests). */
  readonly earned: number;
  readonly available: number;
}

export interface LeagueRow extends LeagueInput {
  /** 1 for the leader; students on the same score share a rank. */
  readonly rank: number;
  readonly learningPoints: number;
  readonly cashPoints: number;
  readonly roundPoints: number;
  readonly points: number;
}

/** The Monday (UTC, `YYYY-MM-DD`) of the week a time falls in. */
export function weekStartOf(ms: number): string {
  const d = new Date(ms);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday))
    .toISOString()
    .slice(0, 10);
}

/** The Monday `weeks` weeks after (or before, if negative) a week start. */
export function addWeeks(weekStart: string, weeks: number): string {
  return new Date(Date.parse(weekStart) + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
}

/** Is this a week start (a Monday, `YYYY-MM-DD`)? */
export function isWeekStart(day: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !Number.isNaN(Date.parse(day)) &&
    weekStartOf(Date.parse(day)) === day
  );
}

/** Weeks between two week starts. */
export const weeksBetween = (a: string, b: string): number => Math.round(daysBetween(a, b) / 7);

/**
 * The league table for one week. Learning pays most (per mark earned), cash is capped, and
 * playing a round pays a little. Ties share a rank and are listed by marks earned, then name.
 */
export function leagueTable(
  inputs: readonly LeagueInput[],
  settings: ProgressionSettings,
): LeagueRow[] {
  const l = settings.league;
  const rows = inputs
    .filter((i) => i.rounds > 0 || i.earned > 0)
    .map((i) => {
      const learningPoints = Math.round(i.earned * l.pointsPerMark);
      const cashPoints = Math.round(Math.min(l.cashCap, (i.banked / 1000) * l.pointsPerThousand));
      const roundPoints = Math.round(i.rounds * l.pointsPerRound);
      return {
        ...i,
        learningPoints,
        cashPoints,
        roundPoints,
        points: learningPoints + cashPoints + roundPoints,
      };
    })
    .sort((a, b) => b.points - a.points || b.earned - a.earned || a.name.localeCompare(b.name));
  let rank = 0;
  return rows.slice(0, l.show).map((r, i, all) => {
    if (i === 0 || r.points !== all[i - 1]?.points) rank = i + 1;
    return { ...r, rank };
  });
}
