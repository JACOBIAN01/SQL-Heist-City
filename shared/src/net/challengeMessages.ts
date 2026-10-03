import { z } from 'zod';
import type { HintResult, IssueResult, RunResult, SubmitResult } from '../challenges/types';

/**
 * Challenge messages on the game WebSocket (JSON frames, see
 * docs/api-protocol.md). Every request carries a client-chosen `ref`; the
 * reply echoes it so the UI can match answers to questions.
 */

const ref = z.number().int().nonnegative();
const challengeId = z.string().min(1).max(100);
/** Players type SQL, but nobody needs 20 kB of it. */
export const MAX_SQL_LENGTH = 5_000;
const sql = z.string().max(MAX_SQL_LENGTH);

export const challengeClientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('challenge_request'),
    ref,
    rewardKey: z.string().min(1).max(100),
    target: z.string().max(100).optional(),
  }),
  z.object({ t: z.literal('challenge_run'), ref, challengeId, sql }),
  z.object({ t: z.literal('challenge_submit'), ref, challengeId, sql }),
  z.object({
    t: z.literal('challenge_hint'),
    ref,
    challengeId,
    index: z.number().int().min(0).max(20),
  }),
  z.object({ t: z.literal('challenge_abandon'), ref }),
]);

export type ChallengeClientMessage = z.infer<typeof challengeClientMessageSchema>;

interface Reply<T extends string, R> {
  readonly t: T;
  readonly ref: number;
  /** Server clock (epoch ms) when the reply was made, so the UI can show lockouts and timers correctly. */
  readonly now: number;
  readonly result: R;
}

export type ChallengeServerMessage =
  | Reply<'challenge', IssueResult>
  | Reply<'challenge_preview', RunResult>
  | Reply<'challenge_result', SubmitResult>
  | Reply<'challenge_hint', HintResult>
  | { readonly t: 'challenge_abandoned'; readonly ref: number; readonly now: number }
  | {
      readonly t: 'challenge_error';
      readonly ref: number | null;
      readonly now: number;
      readonly code: 'bad_message';
      readonly message: string;
    };

export function isChallengeServerMessage(value: unknown): value is ChallengeServerMessage {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as { t?: unknown; now?: unknown };
  return (
    typeof m.t === 'string' &&
    m.t.startsWith('challenge') &&
    typeof m.now === 'number' &&
    (m as { ref?: unknown }).ref !== undefined
  );
}
