import { z } from 'zod';
import { challengeClientMessageSchema, type ChallengeServerMessage } from './challengeMessages';

/**
 * JSON messages of the heist layer (docs/api-protocol.md), carried as `json`
 * frames on the game socket together with the challenge messages.
 */

export const interactMessageSchema = z.object({
  t: z.literal('interact'),
  ref: z.number().int().nonnegative(),
  /** Map anchor id, e.g. "bank-1:lift:0". */
  anchor: z.string().min(1).max(100),
});
export type InteractMessage = z.infer<typeof interactMessageSchema>;

/** Everything a client may send as JSON. The server validates it again; this is the shape check. */
export const jsonClientMessageSchema = z.union([
  challengeClientMessageSchema,
  interactMessageSchema,
]);
export type JsonClientMessage = z.infer<typeof jsonClientMessageSchema>;

export type InteractDenial = 'unknown_anchor' | 'too_far' | 'dead' | 'cooldown' | 'not_available';

/** What using an anchor did. `open_task` tells the client to open the SQL panel on this reward. */
export type InteractResult =
  | { readonly action: 'moved'; readonly storey: number }
  | { readonly action: 'open_task'; readonly rewardKey: string; readonly target: string }
  | { readonly action: 'denied'; readonly reason: InteractDenial };

export interface InteractReply {
  readonly t: 'interact_result';
  readonly ref: number;
  readonly anchor: string;
  readonly result: InteractResult;
}

export type HeistServerMessage = InteractReply;

export type JsonServerMessage = ChallengeServerMessage | HeistServerMessage;
