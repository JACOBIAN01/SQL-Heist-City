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
  /** Half-angle of the random cone each bullet lands in, radians (from the hip, standing still). */
  spread: z.number().min(0).default(0),
  /** Full damage out to this distance (m), then falling off linearly to `falloffMin` × damage at `range`. */
  falloffStart: z.number().positive().optional(),
  falloffMin: z.number().min(0).max(1).default(1),
  /** Extra spread (rad) at a full sprint, in proportion to speed: some guns shoot well on the move, some do not. */
  moveSpread: z.number().min(0).default(0),
  /** Spread is multiplied by this while aiming (right mouse). */
  aimSpread: z.number().min(0).max(1).default(1),
  /** How much the view zooms in while aiming (1 = not at all, 4 = a scope). Seen by the shooter only. */
  aimZoom: z.number().min(1).max(8).default(1),
  /** How far the view kicks up per shot, radians. Seen by the shooter only: they pull it back down. */
  recoil: z.number().min(0).max(0.3).default(0),
});

export type WeaponSpec = z.infer<typeof weaponSpecSchema>;

const gun = (spec: z.input<typeof weaponSpecSchema>): WeaponSpec => weaponSpecSchema.parse(spec);

/**
 * docs/gameplay.md combat table; admins override it in settings (key `combat`).
 * Each tier has a job: the pistol is a fair start; the SMG wins up close and
 * on the move; the shotgun owns a doorway and nothing past it; the rifle
 * wins at mid range when aimed; the sniper owns the long sight lines, but
 * only scoped and standing still.
 */
export const DEFAULT_WEAPONS: Readonly<Record<string, WeaponSpec>> = {
  pistol: gun({
    damage: 18,
    rpm: 300,
    range: 40,
    magSize: 12,
    spread: 0.012,
    falloffStart: 20,
    falloffMin: 0.6,
    moveSpread: 0.02,
    aimSpread: 0.6,
    aimZoom: 1.25,
    recoil: 0.02,
  }),
  smg: gun({
    damage: 12,
    rpm: 750,
    range: 35,
    magSize: 30,
    spread: 0.03,
    falloffStart: 12,
    falloffMin: 0.5,
    moveSpread: 0.01,
    aimSpread: 0.7,
    aimZoom: 1.2,
    recoil: 0.012,
  }),
  shotgun: gun({
    damage: 9,
    rpm: 70,
    range: 15,
    magSize: 6,
    pellets: 8,
    spread: 0.06,
    falloffStart: 6,
    falloffMin: 0.25,
    moveSpread: 0.01,
    aimSpread: 0.8,
    aimZoom: 1.1,
    recoil: 0.06,
  }),
  rifle: gun({
    damage: 28,
    rpm: 450,
    range: 80,
    magSize: 25,
    spread: 0.02,
    falloffStart: 45,
    falloffMin: 0.7,
    moveSpread: 0.05,
    aimSpread: 0.35,
    aimZoom: 1.6,
    recoil: 0.015,
  }),
  sniper: gun({
    damage: 90,
    rpm: 40,
    range: 200,
    magSize: 5,
    spread: 0.03,
    moveSpread: 0.12,
    aimSpread: 0.03,
    aimZoom: 4,
    recoil: 0.08,
  }),
};

/** Damage of one bullet that travelled `distance` m: full up close, falling off past `falloffStart`. */
export function damageAt(spec: WeaponSpec, distance: number): number {
  const start = spec.falloffStart ?? spec.range;
  if (distance <= start || start >= spec.range) return spec.damage;
  const t = Math.min(1, (distance - start) / (spec.range - start));
  return spec.damage * (1 - t * (1 - spec.falloffMin));
}

/**
 * Half-angle of a shot's cone (rad): the gun's base spread, widened by
 * moving (in proportion to speed against a full sprint), narrowed by aiming.
 */
export function spreadFor(
  spec: WeaponSpec,
  speed: number,
  sprintSpeed: number,
  aiming: boolean,
): number {
  const moving = sprintSpeed > 0 ? Math.min(1, speed / sprintSpeed) : 0;
  return (spec.spread + spec.moveSpread * moving) * (aiming ? spec.aimSpread : 1);
}

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
