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
  /**
   * The street crowd (Phase 29.1): people on the sidewalks. They are scenery: drawn by each
   * client, never part of the game state, and nothing can hurt or hit them.
   */
  crowd: z
    .object({
      /** People in the whole city; 0 switches the crowd off. */
      count: z.number().int().min(0).max(2000).default(300),
      walkSpeed: z.number().positive().max(4).default(1.3),
      fleeSpeed: z.number().positive().max(10).default(4.2),
      /** A shot within this many metres sends people running. */
      hearRadius: z.number().positive().max(300).default(45),
      fleeSeconds: z.number().positive().max(60).default(8),
      /** Only people within this many metres of you are simulated and drawn. */
      drawRadius: z.number().positive().max(400).default(110),
      /** Beyond this they are drawn as one plain shape instead of a person. */
      detailRadius: z.number().positive().max(200).default(45),
    })
    .default({
      count: 300,
      walkSpeed: 1.3,
      fleeSpeed: 4.2,
      hearRadius: 45,
      fleeSeconds: 8,
      drawRadius: 110,
      detailRadius: 45,
    }),
});

export type AtmosphereSettings = z.infer<typeof atmosphereSettingsSchema>;
export const DEFAULT_ATMOSPHERE_SETTINGS: AtmosphereSettings = atmosphereSettingsSchema.parse({});

/** Hour of day (0 ≤ h < 24) a given time after the match started. */
export function hourAt(matchMs: number, settings: AtmosphereSettings): number {
  const hours = settings.startHour + (matchMs / (settings.dayMinutes * 60_000)) * 24;
  return ((hours % 24) + 24) % 24;
}
