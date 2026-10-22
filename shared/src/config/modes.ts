import { z } from 'zod';
import { heistSettingsSchema, type HeistSettings } from './heist';

/**
 * Game modes (Phase 28): a class picks one, and each is only a set of rules held as settings. A
 * mode changes the heist numbers it names, may limit how many banks are open, and says whether
 * the room plays a heist or SQL duels. Adding or changing a mode is an admin edit, not a code
 * change.
 */
export const MODE_KINDS = ['heist', 'duel'] as const;
export type ModeKind = (typeof MODE_KINDS)[number];

export const duelSettingsSchema = z.object({
  /** Draws (questions) per duel; the first to win more than half takes it. */
  draws: z.number().int().min(1).max(9).default(5),
  /** Seconds the players see "get ready" before each draw's question appears. */
  countdownSeconds: z.number().min(0).max(30).default(3),
  /** Seconds a draw may last; nobody solving it counts as no point. */
  drawSeconds: z.number().positive().max(600).default(120),
  /** Highest question tier a duel draws (duels are meant to be quick). */
  maxTier: z.number().int().min(1).max(5).default(2),
});
export type DuelSettings = z.infer<typeof duelSettingsSchema>;

export const modeSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(40),
  description: z.string().max(300).default(''),
  kind: z.enum(MODE_KINDS).default('heist'),
  /** Heist settings this mode changes (any key of the heist settings; the rest stay as set). */
  heist: z.record(z.string(), z.unknown()).default({}),
  /** At most this many banks are open (the lowest tiers the class has open); none for no limit. */
  bankLimit: z.number().int().min(0).max(5).nullable().default(null),
  /** Duel rules, for the duel kind. */
  duel: duelSettingsSchema.default({ draws: 5, countdownSeconds: 3, drawSeconds: 120, maxTier: 2 }),
});
export type Mode = z.infer<typeof modeSchema>;

/** The heist settings with a mode's changes put on top. A change that does not fit the schema is dropped, never half-applied. */
export function applyModeHeist(heist: HeistSettings, mode: Mode): HeistSettings {
  const merged = heistSettingsSchema.safeParse({ ...heist, ...mode.heist });
  return merged.success ? merged.data : heist;
}

/** Whether every change a mode makes is valid heist settings (for the admin to check before saving). */
export function modeHeistProblem(mode: Pick<Mode, 'heist'>): string | undefined {
  const known = new Set(Object.keys(heistSettingsSchema.shape));
  const unknown = Object.keys(mode.heist).filter((k) => !known.has(k));
  if (unknown.length) return `not a heist setting: ${unknown.join(', ')}`;
  const parsed = heistSettingsSchema.safeParse({ ...heistSettingsSchema.parse({}), ...mode.heist });
  return parsed.success
    ? undefined
    : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

export const DEFAULT_MODES: readonly Mode[] = [
  {
    id: 'classic',
    name: 'Classic heist',
    description:
      'The full city, every bank the class has open, a full-length round. The teacher can pick the length.',
    kind: 'heist',
    heist: {},
    bankLimit: null,
    duel: duelSettingsSchema.parse({}),
  },
  {
    id: 'smash-and-grab',
    name: 'Smash and Grab',
    description:
      'A fast five-minute round on a single bank: two locks, quick to crack, a short scramble to bank.',
    kind: 'heist',
    heist: {
      roundMinutes: 5,
      locksPerVault: 2,
      overtimeSeconds: 20,
      intermissionSeconds: 10,
      joinWindowMinutes: 1,
    },
    bankLimit: 1,
    duel: duelSettingsSchema.parse({}),
  },
  {
    id: 'quick-draw',
    name: 'SQL Quick Draw',
    description:
      'One against one: the same question for both, and the first correct answer wins the point. Best of five.',
    kind: 'duel',
    heist: { roundMinutes: 10, intermissionSeconds: 10 },
    bankLimit: 0,
    duel: duelSettingsSchema.parse({}),
  },
];

export const modesSettingsSchema = z.object({
  modes: z
    .array(modeSchema)
    .min(1)
    .refine((all) => new Set(all.map((m) => m.id)).size === all.length, 'two modes share an id')
    .refine((all) => all.some((m) => m.id === 'classic'), 'there must be a "classic" mode')
    .refine(
      (all) => all.every((m) => modeHeistProblem(m) === undefined),
      'a mode changes a heist setting that does not exist or is not valid',
    )
    .default([...DEFAULT_MODES]),
});
export type ModesSettings = z.infer<typeof modesSettingsSchema>;
export const DEFAULT_MODES_SETTINGS: ModesSettings = modesSettingsSchema.parse({});

/** The mode a class asked for; "classic" when it is unknown (a mode removed from the settings), so a class always plays. */
export function modeById(settings: ModesSettings, id: string): Mode {
  return (
    settings.modes.find((m) => m.id === id) ??
    settings.modes.find((m) => m.id === 'classic') ??
    (DEFAULT_MODES[0] as Mode)
  );
}

/** Which banks (tiers) stay open: the class's own, cut down to the mode's limit, lowest tiers first. */
export function banksForMode(open: readonly number[], mode: Pick<Mode, 'bankLimit'>): number[] {
  const sorted = [...open].sort((a, b) => a - b);
  return mode.bankLimit === null ? sorted : sorted.slice(0, mode.bankLimit);
}
