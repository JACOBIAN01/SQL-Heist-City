import { z } from 'zod';

/**
 * Time of day. Defaults only. Every client derives the hour from the match's
 * server clock with these numbers, so all players share one sky.
 */
export const atmosphereSettingsSchema = z.object({
  /** Real minutes for one full day. 30 takes a 15-minute round from morning into the evening. */
  dayMinutes: z.number().positive().default(30),
  /** Hour of day (0–24) when the match starts. */
  startHour: z.number().min(0).max(24).default(9),
});

export type AtmosphereSettings = z.infer<typeof atmosphereSettingsSchema>;
export const DEFAULT_ATMOSPHERE_SETTINGS: AtmosphereSettings = atmosphereSettingsSchema.parse({});

/** Hour of day (0 ≤ h < 24) a given time after the match started. */
export function hourAt(matchMs: number, settings: AtmosphereSettings): number {
  const hours = settings.startHour + (matchMs / (settings.dayMinutes * 60_000)) * 24;
  return ((hours % 24) + 24) % 24;
}
