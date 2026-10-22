import type { ProgressionSettings, Season } from '../config/progression';
import { daysBetween } from './contracts';

/** One step of a season's track as the student sees it. */
export interface TrackStep {
  readonly level: number;
  readonly xp: number;
  readonly cosmetic: string;
  readonly cosmeticName: string;
  readonly unlocked: boolean;
}

export interface SeasonView {
  readonly id: string;
  readonly name: string;
  readonly theme: string;
  readonly start: string;
  readonly end: string;
  /** Whole days left including today (0 once it has ended). */
  readonly daysLeft: number;
  /** True while it runs, false before it starts or after it ends. */
  readonly active: boolean;
  readonly xp: number;
  /** Steps of the track reached. */
  readonly level: number;
  readonly track: readonly TrackStep[];
}

/** The season running on `day` (`YYYY-MM-DD`), if any. */
export function activeSeason(settings: ProgressionSettings, day: string): Season | undefined {
  return settings.seasons.find((s) => s.start <= day && day <= s.end);
}

/** A season as the student sees it, with their season XP. */
export function seasonView(
  season: Season,
  xp: number,
  today: string,
  settings: ProgressionSettings,
): SeasonView {
  const track = season.track.map((step, i) => ({
    level: i + 1,
    xp: step.xp,
    cosmetic: step.cosmetic,
    cosmeticName: settings.cosmetics.find((c) => c.id === step.cosmetic)?.name ?? step.cosmetic,
    unlocked: xp >= step.xp,
  }));
  return {
    id: season.id,
    name: season.name,
    theme: season.theme,
    start: season.start,
    end: season.end,
    daysLeft: Math.max(0, daysBetween(today, season.end) + 1),
    active: season.start <= today && today <= season.end,
    xp,
    level: track.filter((t) => t.unlocked).length,
    track,
  };
}
