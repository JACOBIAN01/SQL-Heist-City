import { z } from 'zod';

/** What a class question may be used for: the four ways a player earns something with SQL. */
export const QUESTION_USAGES = ['vault', 'heal', 'gun', 'ammo'] as const;
export type QuestionUsage = (typeof QUESTION_USAGES)[number];

/** Which usage a reward key belongs to (`vault:…`, `heal:small`, `gun:rifle`, `ammo:refill`). */
export function usageOfReward(rewardKey: string): QuestionUsage | undefined {
  const family = rewardKey.split(':')[0];
  return QUESTION_USAGES.find((u) => u === family);
}

export const MIN_CLASS_PLAYERS = 60;
export const MAX_CLASS_PLAYERS = 200;

const nameField = z.string().trim().min(1).max(80);
/** Same seed, same city for everyone in the class; none uses the server's default city. */
const citySeedField = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .nullable();
/** Banks (by tier, 1–5) whose vaults may be worked; the rest are closed. */
const banksField = z
  .array(z.number().int().min(1).max(5))
  .max(5)
  .transform((banks) => [...new Set(banks)].sort());
/** Round length in minutes; none uses the heist setting. */
const roundField = z.number().positive().max(120).nullable();
const capField = z.number().int().min(MIN_CLASS_PLAYERS).max(MAX_CLASS_PLAYERS);
/** The dialect pack whose notes the pop-up shows (the game itself always runs SQLite). */
const dialectField = z.string().regex(/^[a-z][a-z0-9-]{0,30}$/);

/**
 * How students are put into squads (Phase 27): `off` plays as individuals; `teacher` uses the
 * teacher's list; `self` lets students pick a squad in the room; `auto` is balanced by mastery
 * when the teacher presses the button (and stored like a teacher's list).
 */
export const SQUAD_MODES = ['off', 'teacher', 'self', 'auto'] as const;
export type SquadMode = (typeof SQUAD_MODES)[number];
const squadModeField = z.enum(SQUAD_MODES);
const squadSizeField = z.number().int().min(3).max(4);

/** The roles a squad member may take (Phase 27.3). */
export const SQUAD_ROLES = ['hacker', 'driver', 'enforcer', 'lookout'] as const;
export type SquadRole = (typeof SQUAD_ROLES)[number];

/** What a teacher sets when making a class. */
export const classInputSchema = z.object({
  name: nameField,
  citySeed: citySeedField.default(null),
  banksOpen: banksField.default([1, 2, 3, 4, 5]),
  roundMinutes: roundField.default(null),
  playerCap: capField.default(100),
  dialect: dialectField.default('sqlite'),
  squadMode: squadModeField.default('off'),
  squadSize: squadSizeField.default(4),
});

/** An edit: only what is given changes (no defaults, so a rename never resets the banks). */
export const classUpdateSchema = z.object({
  name: nameField.optional(),
  citySeed: citySeedField.optional(),
  banksOpen: banksField.optional(),
  roundMinutes: roundField.optional(),
  playerCap: capField.optional(),
  dialect: dialectField.optional(),
  squadMode: squadModeField.optional(),
  squadSize: squadSizeField.optional(),
});

export type ClassInput = z.infer<typeof classInputSchema>;

import type { ClassConsent } from '../legal/consent';

export interface ClassRecord extends ClassInput {
  readonly id: number;
  /** What students type to join. */
  readonly code: string;
  readonly ownerUserId: number | null;
  /** No new students may join while locked. */
  readonly locked: boolean;
  readonly archived: boolean;
  /** When it was archived (the retention clock), if it is. */
  readonly archivedAt: string | null;
  /** The school's acceptance of the terms; a class cannot start without a current one. */
  readonly consent: ClassConsent | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClassMember {
  readonly playerId: number;
  readonly joinedAt: string;
}

export interface ClassQuestionLink {
  readonly questionId: number;
  readonly usage: QuestionUsage;
}

/** A released question with what the admin needs to show it. */
export interface ClassQuestionView extends ClassQuestionLink {
  readonly slug: string | null;
  readonly title: string;
  readonly tier: number | null;
}

export interface RosterEntry {
  readonly playerId: number;
  readonly joinedAt: string;
  readonly displayName: string;
  readonly email: string | null;
}
