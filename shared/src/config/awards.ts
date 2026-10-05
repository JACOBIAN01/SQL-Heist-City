/** The awards handed out at the end of every round (docs/gameplay.md "Round awards"). */
export const AWARD_IDS = [
  'safecracker',
  'quick_draw',
  'sql_brain',
  'top_gun',
  'bounty_hunter',
  'big_haul',
] as const;
export type AwardId = (typeof AWARD_IDS)[number];

/** How an award's number reads: cash, a count, or seconds. */
export type AwardUnit = 'money' | 'count' | 'seconds';

export interface AwardInfo {
  readonly title: string;
  /** What it is for, in a few words. */
  readonly for: string;
  readonly unit: AwardUnit;
}

/** The words for each award; the server only says who won it and with what number. */
export const AWARDS: Readonly<Record<AwardId, AwardInfo>> = {
  safecracker: { title: 'Safecracker', for: 'most vault locks cracked', unit: 'count' },
  quick_draw: { title: 'Quick Draw', for: 'fastest correct SQL answer', unit: 'seconds' },
  sql_brain: { title: 'SQL Brain', for: 'most SQL tasks solved', unit: 'count' },
  top_gun: { title: 'Top Gun', for: 'most kills', unit: 'count' },
  bounty_hunter: { title: 'Bounty Hunter', for: 'most bounty cash claimed', unit: 'money' },
  big_haul: { title: 'Big Haul', for: 'biggest single banking', unit: 'money' },
};
