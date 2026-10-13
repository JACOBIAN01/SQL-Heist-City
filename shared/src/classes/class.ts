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

/** What a teacher sets when making a class. */
export const classInputSchema = z.object({
  name: nameField,
  citySeed: citySeedField.default(null),
  banksOpen: banksField.default([1, 2, 3, 4, 5]),
  roundMinutes: roundField.default(null),
  playerCap: capField.default(100),
});

/** An edit: only what is given changes (no defaults, so a rename never resets the banks). */
export const classUpdateSchema = z.object({
  name: nameField.optional(),
  citySeed: citySeedField.optional(),
  banksOpen: banksField.optional(),
  roundMinutes: roundField.optional(),
  playerCap: capField.optional(),
});

export type ClassInput = z.infer<typeof classInputSchema>;

export interface ClassRecord extends ClassInput {
  readonly id: number;
  /** What students type to join. */
  readonly code: string;
  readonly ownerUserId: number | null;
  /** No new students may join while locked. */
  readonly locked: boolean;
  readonly archived: boolean;
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
