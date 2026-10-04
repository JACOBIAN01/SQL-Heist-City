import { z } from 'zod';

export const weaponSpecSchema = z.object({
  damage: z.number().positive(),
  /** Rounds per minute. */
  rpm: z.number().positive(),
  /** Metres. */
  range: z.number().positive(),
  magSize: z.number().int().positive(),
  /** Bullets per shot (shotgun). */
  pellets: z.number().int().positive().default(1),
  /** Half-angle of the random cone each bullet lands in, radians. */
  spread: z.number().min(0).default(0),
});

export type WeaponSpec = z.infer<typeof weaponSpecSchema>;

/** docs/gameplay.md combat table. Editable in admin settings later. */
export const DEFAULT_WEAPONS: Readonly<Record<string, WeaponSpec>> = {
  pistol: { damage: 18, rpm: 300, range: 40, magSize: 12, pellets: 1, spread: 0.012 },
  smg: { damage: 12, rpm: 750, range: 35, magSize: 30, pellets: 1, spread: 0.03 },
  shotgun: { damage: 9, rpm: 70, range: 15, magSize: 6, pellets: 8, spread: 0.06 },
  rifle: { damage: 28, rpm: 450, range: 80, magSize: 25, pellets: 1, spread: 0.008 },
  sniper: { damage: 90, rpm: 40, range: 200, magSize: 5, pellets: 1, spread: 0.001 },
};

/**
 * The guns, in a fixed order the wire format indexes into (0 means unarmed).
 * Stats come from the weapon table and can change; adding a gun means
 * appending here and in the table.
 */
export const WEAPON_IDS = ['pistol', 'smg', 'shotgun', 'rifle', 'sniper'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

export const weaponToWire = (id: string): number => WEAPON_IDS.indexOf(id as WeaponId) + 1;
export const weaponFromWire = (wire: number): WeaponId | undefined => WEAPON_IDS[wire - 1];

export const combatSettingsSchema = z.object({
  weapons: z.record(z.string(), weaponSpecSchema).default({ ...DEFAULT_WEAPONS }),
  /**
   * Weapon everyone holds in the Phase 5 sandbox. From Phase 7 players start
   * unarmed and earn guns through SQL, so this goes away.
   */
  sandboxWeapon: z.string().default('rifle'),
  /** Hit-box: an upright cylinder of this radius (m); the top `headHeight` metres is the head. */
  bodyRadius: z.number().positive().default(0.4),
  headHeight: z.number().positive().default(0.2),
  headshotMultiplier: z.number().min(1).default(2),
  maxHp: z.number().int().positive().default(100),
  respawnDelaySec: z.number().min(0).default(5),
  respawnHp: z.number().int().positive().default(50),
  /** Seconds after (re)spawning that a player cannot be hurt. */
  spawnProtectionSec: z.number().min(0).default(5),
  /** Most the server rewinds targets for a shot (ms): bounds how far "behind the corner" shots reach. */
  maxLagCompMs: z.number().int().min(0).default(200),
});

export type CombatSettings = z.infer<typeof combatSettingsSchema>;
export const DEFAULT_COMBAT_SETTINGS: CombatSettings = combatSettingsSchema.parse({});
