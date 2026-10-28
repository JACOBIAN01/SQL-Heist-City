import { z } from 'zod';
import type { Mode } from './modes';
import { duelSettingsSchema } from './modes';

/**
 * A teacher's own heist (Phase 34.5): a short story and a chain of questions, played on one bank.
 * Each lock of the vault asks the question the teacher chose, in order, the same for every student
 * (the variant is the student's own, as in any question). A teacher saves it, gives its share code
 * to another teacher, and a class plays it by picking it as its mode.
 */
export const customHeistSpecSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** What the crew says before it starts, a few lines. */
  story: z
    .object({
      title: z.string().trim().min(1).max(60),
      lines: z
        .array(
          z.object({
            speaker: z.string().trim().min(1).max(40),
            text: z.string().trim().min(1).max(280),
          }),
        )
        .min(1)
        .max(8),
    })
    .default({ title: 'The job', lines: [{ speaker: 'Crew', text: 'Here is the plan.' }] }),
  /** The bank the heist is on (1–5). */
  bank: z.number().int().min(1).max(5).default(1),
  /** The question for each lock, in order, by slug. */
  locks: z
    .array(
      z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .max(120),
    )
    .min(1)
    .max(5),
  /** Minutes the round lasts. */
  roundMinutes: z.number().positive().max(120).default(15),
});
export type CustomHeistSpec = z.infer<typeof customHeistSpecSchema>;

/** The mode id a class stores to play custom heist `id`. */
export const customModeId = (id: number): string => `custom-${id}`;

/** The custom heist a mode id names, or undefined. */
export function parseCustomModeId(modeId: string): number | undefined {
  const m = /^custom-(\d+)$/.exec(modeId);
  return m ? Number(m[1]) : undefined;
}

/** The mode a custom heist plays as: one bank, as many locks as questions, its own round length. */
export function customMode(id: number, spec: CustomHeistSpec): Mode & { custom: CustomHeistSpec } {
  return {
    id: customModeId(id),
    name: spec.name,
    description: spec.story.title,
    kind: 'heist',
    heist: { locksPerVault: spec.locks.length, roundMinutes: spec.roundMinutes },
    bankLimit: 1,
    duel: duelSettingsSchema.parse({}),
    custom: spec,
  };
}

/** A fresh share code: eight letters and digits that are easy to read out (no 0, O, 1, I). */
export function newShareCode(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
}

export const SHARE_CODE = /^[A-HJ-NP-Z2-9]{8}$/;
