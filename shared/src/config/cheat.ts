import { z } from 'zod';

/**
 * The owner's cheat code (Phase 37): a secret key combination opens a prompt, and the right code
 * solves and passes the question that is open. Everything here is a setting. The code itself is
 * only ever stored as a hash and checked on the server; the combination is just the trigger.
 */

/** Where the cheat works: nowhere, local/staging only, the tutorial only, chosen classes, or everywhere. */
export const CHEAT_SCOPES = ['off', 'dev', 'tutorial', 'rooms', 'all'] as const;
export type CheatScope = (typeof CHEAT_SCOPES)[number];

const keyCode = z.string().regex(/^[A-Za-z0-9]{2,20}$/);

export const cheatSettingsSchema = z.object({
  scope: z.enum(CHEAT_SCOPES).default('off'),
  /** The classes it works in when the scope is `rooms`. */
  classIds: z.array(z.number().int().positive()).max(200).default([]),
  /** scrypt hash of the code; empty until the owner sets one. Never sent to a client. */
  codeHash: z.string().max(300).default(''),
  /** `KeyboardEvent.code` values held together to open the prompt (2 or 3 keys). */
  combo: z.array(keyCode).min(2).max(3).default(['ControlLeft', 'ShiftLeft', 'KeyK']),
  /** Pay the question's in-game reward (cash, heal, gun, lock) when it is passed. */
  payReward: z.boolean().default(true),
  /** Passes one player may use in a round; 0 means no limit. */
  maxPerRound: z.number().int().min(0).max(1000).default(0),
  /** Wrong codes in a row before a player is locked out, and for how long. */
  lockoutTries: z.number().int().min(1).max(20).default(5),
  lockoutSeconds: z.number().int().min(10).max(86_400).default(300),
});
export type CheatSettings = z.infer<typeof cheatSettingsSchema>;
export const DEFAULT_CHEAT_SETTINGS: CheatSettings = cheatSettingsSchema.parse({});

/** The shortest code the admin may set. */
export const CHEAT_CODE_MIN_LENGTH = 6;
export const CHEAT_CODE_MAX_LENGTH = 100;

/** What the admin page sees: everything but the hash, and whether a code is set. */
export type CheatAdminView = Omit<CheatSettings, 'codeHash'> & { readonly codeSet: boolean };

export const cheatAdminView = ({ codeHash, ...rest }: CheatSettings): CheatAdminView => ({
  ...rest,
  codeSet: codeHash !== '',
});

/** What a client is told: only the trigger, and only when the cheat can work at all. */
export interface CheatClientView {
  readonly combo: readonly string[];
}
