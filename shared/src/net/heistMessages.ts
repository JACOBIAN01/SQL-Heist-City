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

/** Lock progress of one vault. */
export interface VaultView {
  readonly id: string;
  readonly tier: number;
  readonly locks: number;
  /** Locks opened so far; the vault is open when this reaches `locks`. */
  readonly opened: number;
}

/** Every vault's progress: sent on join and whenever a lock opens. */
export interface VaultsMessage {
  readonly t: 'vaults';
  readonly vaults: readonly VaultView[];
}

/** A short message for the player ("Someone beat you to the lock"). */
export interface NoticeMessage {
  readonly t: 'notice';
  readonly text: string;
}

export type HeistServerMessage = InteractReply | VaultsMessage | NoticeMessage;

export type JsonServerMessage = ChallengeServerMessage | HeistServerMessage;
