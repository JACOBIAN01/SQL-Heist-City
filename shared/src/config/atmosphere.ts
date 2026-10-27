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
  /**
   * Weather (Phase 29.5): the match clock is cut into spells, each clear, foggy, rainy or stormy,
   * picked from the match seed so every player sees the same sky. Scenery only: it changes how far
   * you see and what you hear, never how anything is hit or graded.
   */
  weather: z
    .object({
      enabled: z.boolean().default(true),
      /** Real minutes one spell of weather lasts. */
      spellMinutes: z.number().positive().max(60).default(3),
      /** Seconds to change from one spell to the next. */
      blendSeconds: z.number().min(0).max(120).default(30),
      /** Relative chance of each spell; 0 never happens. */
      weights: z
        .object({
          clear: z.number().min(0).default(4),
          fog: z.number().min(0).default(1),
          rain: z.number().min(0).default(2),
          storm: z.number().min(0).default(1),
        })
        .default({ clear: 4, fog: 1, rain: 2, storm: 1 }),
      /** Fog distances are multiplied by this much in the thickest fog (0.2 = see a fifth as far). */
      fogVisibility: z.number().min(0.05).max(1).default(0.12),
      /** Rain streaks drawn around you (0 turns the picture off, the sound stays). */
      rainDrops: z.number().int().min(0).max(4000).default(900),
    })
    .default({
      enabled: true,
      spellMinutes: 3,
      blendSeconds: 30,
      weights: { clear: 4, fog: 1, rain: 2, storm: 1 },
      fogVisibility: 0.12,
      rainDrops: 900,
    }),
});

export type AtmosphereSettings = z.infer<typeof atmosphereSettingsSchema>;
export const DEFAULT_ATMOSPHERE_SETTINGS: AtmosphereSettings = atmosphereSettingsSchema.parse({});

/** Hour of day (0 ≤ h < 24) a given time after the match started. */
export function hourAt(matchMs: number, settings: AtmosphereSettings): number {
  const hours = settings.startHour + (matchMs / (settings.dayMinutes * 60_000)) * 24;
  return ((hours % 24) + 24) % 24;
}

export const WEATHER_KINDS = ['clear', 'fog', 'rain', 'storm'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

/** How wet and how foggy the air is, each 0 (none) to 1 (as much as there gets). */
export interface Weather {
  readonly rain: number;
  readonly fog: number;
  /** The spell being blended towards. */
  readonly kind: WeatherKind;
}

const LOOK: Record<WeatherKind, { rain: number; fog: number }> = {
  clear: { rain: 0, fog: 0 },
  fog: { rain: 0, fog: 1 },
  rain: { rain: 0.6, fog: 0.35 },
  storm: { rain: 1, fog: 0.6 },
};

function hash(seed: string, n: number): number {
  let h = 2166136261 ^ n;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** The kind of weather in spell number `spell` of a match. The first spell is always clear. */
export function spellKind(seed: string, spell: number, settings: AtmosphereSettings): WeatherKind {
  if (spell <= 0) return 'clear';
  const w = settings.weather.weights;
  const total = w.clear + w.fog + w.rain + w.storm;
  if (total <= 0) return 'clear';
  let pick = hash(seed, spell) * total;
  for (const kind of WEATHER_KINDS) {
    pick -= w[kind];
    if (pick < 0) return kind;
  }
  return 'clear';
}

/** The weather a given time after the match started: the spell's look, blended in from the last. */
export function weatherAt(matchMs: number, seed: string, settings: AtmosphereSettings): Weather {
  const cfg = settings.weather;
  if (!cfg.enabled) return { rain: 0, fog: 0, kind: 'clear' };
  const spellMs = cfg.spellMinutes * 60_000;
  const spell = Math.max(0, Math.floor(matchMs / spellMs));
  const kind = spellKind(seed, spell, settings);
  const now = LOOK[kind];
  if (spell === 0) return { ...now, kind };
  const before = LOOK[spellKind(seed, spell - 1, settings)];
  const into = matchMs - spell * spellMs;
  const t = cfg.blendSeconds <= 0 ? 1 : Math.min(1, into / (cfg.blendSeconds * 1000));
  const e = t * t * (3 - 2 * t);
  return {
    rain: before.rain + (now.rain - before.rain) * e,
    fog: before.fog + (now.fog - before.fog) * e,
    kind,
  };
}
export type WeatherSettings = AtmosphereSettings['weather'];
