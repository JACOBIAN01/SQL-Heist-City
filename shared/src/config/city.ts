import { z } from 'zod';

/**
 * How the city is generated (docs/city-kit.md, "One grid everywhere").
 * Defaults only. Both sides must build the same city, so the numbers that
 * shape it travel with the map id (`city:<seed>`), not as server-only state.
 */
export const citySettingsSchema = z
  .object({
    /** Same seed ⇒ same city, on server and client alike. */
    seed: z.string().min(1).default('heist-city'),
    /** Blocks per side: the city is blocks × blocks. */
    blocks: z.number().int().min(4).max(8).default(5),
    /** Block + one street, m. 64 = one AOI cell = one render chunk. */
    blockPitch: z.number().int().positive().default(64),
    streetWidth: z.number().int().positive().default(12),
    sidewalkWidth: z.number().int().positive().default(3),
    /** Gap between the lots of a block, m. */
    alleyWidth: z.number().int().positive().default(4),
    /** Narrowest lot side, m. */
    minLot: z.number().int().positive().default(14),
    /** Floor to floor, m (the kit module). */
    storeyHeight: z.number().positive().default(3),
    minStoreys: z.number().int().min(1).default(2),
    maxStoreys: z.number().int().min(1).default(7),
    /** Chance an ordinary lot is an open plaza instead of a building. */
    plazaChance: z.number().min(0).max(1).default(0.15),
    /** Bank sites, tier 1 (outskirts) to tier `banks` (centre). */
    banks: z.number().int().min(1).max(5).default(5),
    safehouses: z.number().int().min(1).max(6).default(3),
    /** Hospital beds: where the dead come back. */
    hospitalBeds: z.number().int().min(1).max(32).default(8),
    /** Chance each kerbside parking slot (four per street side per block) holds a car. */
    parkedCarChance: z.number().min(0).max(1).default(0.12),
  })
  .refine((s) => s.minStoreys <= s.maxStoreys, 'minStoreys must not exceed maxStoreys')
  .refine(
    (s) => (s.blockPitch - s.streetWidth - 2 * s.sidewalkWidth - s.alleyWidth) % 2 === 0,
    'a block must split into lots on the 2 m kit grid',
  )
  .refine(
    (s) => s.blockPitch - s.streetWidth - 2 * s.sidewalkWidth - s.alleyWidth >= 2 * s.minLot,
    'a block must fit two lots and an alley each way',
  )
  .refine((s) => s.banks + s.safehouses + 1 <= s.blocks * s.blocks, 'more sites than blocks');

export type CitySettings = z.infer<typeof citySettingsSchema>;
export const DEFAULT_CITY_SETTINGS: CitySettings = citySettingsSchema.parse({});
