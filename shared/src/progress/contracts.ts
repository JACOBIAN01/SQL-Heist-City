import type { ContractTemplate, ProgressionSettings } from '../config/progression';
import { SeededRng, seedOf } from '../random/Rng';
import type { ItemRecord } from '../analytics/items';

/** A contract dealt to one student on one day, with how far along it is. */
export interface ContractState {
  readonly id: string;
  readonly progress: number;
  readonly done: boolean;
}

/** A contract as the client shows it: the template's facts plus the progress. */
export interface ContractView {
  readonly id: string;
  readonly kind: ContractTemplate['kind'];
  /** The skill-tree node's name for a `topic` contract. */
  readonly skill?: string;
  readonly tier?: number;
  readonly count: number;
  readonly xp: number;
  readonly progress: number;
  readonly done: boolean;
}

/** The calendar day (UTC, `YYYY-MM-DD`) of a time in milliseconds. */
export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Whole days from `a` to `b` (both `YYYY-MM-DD`). */
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * Deals the day's contracts: the same student on the same day always gets the same ones, and no
 * two of a day are the same template. Different students get different mixes.
 */
export function dealContracts(
  day: string,
  accountId: number,
  settings: ProgressionSettings,
): ContractState[] {
  const { templates, perDay } = settings.contracts;
  const rng = new SeededRng(seedOf('contracts', day, accountId));
  return rng
    .shuffle(templates)
    .slice(0, perDay)
    .map((t) => ({ id: t.id, progress: 0, done: false }));
}

/** Does a finished question count toward a contract? Only questions solved or answered in full, never the tutorial. */
export function countsFor(
  template: ContractTemplate,
  item: Pick<
    ItemRecord,
    | 'outcome'
    | 'tier'
    | 'topics'
    | 'tutorial'
    | 'wrongSubmits'
    | 'hintsPaid'
    | 'assessment'
    | 'share'
  >,
  settings: ProgressionSettings,
): boolean {
  if (item.tutorial || item.assessment) return false;
  if (item.outcome !== 'solved' && !(item.outcome === 'answered' && (item.share ?? 0) >= 1))
    return false;
  switch (template.kind) {
    case 'tier':
      return item.tier >= (template.tier ?? 1);
    case 'clean':
      return item.wrongSubmits === 0 && item.hintsPaid === 0;
    case 'topic': {
      const node = settings.skills.tree.find((n) => n.id === template.skill);
      return node !== undefined && item.topics.some((t) => node.topics.includes(t));
    }
  }
}

/** The state after one finished question, and which contracts it completed. */
export function advanceContracts(
  state: readonly ContractState[],
  item: Parameters<typeof countsFor>[1],
  settings: ProgressionSettings,
): { state: ContractState[]; completed: string[] } {
  const completed: string[] = [];
  const next = state.map((c) => {
    if (c.done) return c;
    const template = settings.contracts.templates.find((t) => t.id === c.id);
    if (!template || !countsFor(template, item, settings)) return c;
    const progress = Math.min(template.count, c.progress + 1);
    const done = progress >= template.count;
    if (done) completed.push(c.id);
    return { id: c.id, progress, done };
  });
  return { state: next, completed };
}

/** XP for a finished contract, with the day-streak bonus. */
export function contractXp(
  template: ContractTemplate,
  streakDays: number,
  settings: ProgressionSettings,
): number {
  const { streakBonusPerDay, streakCap } = settings.contracts;
  const days = Math.min(streakCap, Math.max(0, streakDays - 1));
  return Math.round(template.xp * (1 + streakBonusPerDay * days));
}

export interface DayStreak {
  readonly days: number;
  /** The last day a contract was finished (`YYYY-MM-DD`), or '' for never. */
  readonly lastDay: string;
}

/** The streak after finishing a contract on `today`: the same day changes nothing, the next day adds one, a gap starts again. */
export function streakAfterFinishing(prev: DayStreak, today: string): DayStreak {
  if (prev.lastDay === today) return prev;
  const gap = prev.lastDay ? daysBetween(prev.lastDay, today) : Infinity;
  return { days: gap === 1 ? prev.days + 1 : 1, lastDay: today };
}

/** The streak as it stands on `today` for display: a missed day has already ended it (if one more day passes unfinished). */
export function streakOn(prev: DayStreak, today: string): number {
  if (!prev.lastDay) return 0;
  return daysBetween(prev.lastDay, today) <= 1 ? prev.days : 0;
}

/** The views of a day's state. */
export function contractViews(
  state: readonly ContractState[],
  settings: ProgressionSettings,
): ContractView[] {
  return state.flatMap((c) => {
    const t = settings.contracts.templates.find((x) => x.id === c.id);
    if (!t) return [];
    const skill = t.skill ? settings.skills.tree.find((n) => n.id === t.skill)?.name : undefined;
    return [
      {
        id: t.id,
        kind: t.kind,
        ...(skill ? { skill } : {}),
        ...(t.tier ? { tier: t.tier } : {}),
        count: t.count,
        xp: t.xp,
        progress: c.progress,
        done: c.done,
      },
    ];
  });
}
