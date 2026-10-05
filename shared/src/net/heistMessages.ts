import { z } from 'zod';
import type { WeaponSpec } from '../config/combat';
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

/** Hold a gun you own. */
export const equipMessageSchema = z.object({
  t: z.literal('equip'),
  weapon: z.string().min(1).max(30),
});
export type EquipMessage = z.infer<typeof equipMessageSchema>;

/** Get into a car (by its id) or out of the one you drive. */
export const vehicleMessageSchema = z.discriminatedUnion('action', [
  z.object({
    t: z.literal('vehicle'),
    ref: z.number().int().nonnegative(),
    action: z.literal('enter'),
    vehicle: z.number().int().min(1).max(0xffff),
  }),
  z.object({
    t: z.literal('vehicle'),
    ref: z.number().int().nonnegative(),
    action: z.literal('exit'),
  }),
]);
export type VehicleMessage = z.infer<typeof vehicleMessageSchema>;

/** Everything a client may send as JSON. The server validates it again; this is the shape check. */
export const jsonClientMessageSchema = z.union([
  challengeClientMessageSchema,
  interactMessageSchema,
  equipMessageSchema,
  vehicleMessageSchema,
]);
export type JsonClientMessage = z.infer<typeof jsonClientMessageSchema>;

export type InteractDenial =
  | 'unknown_anchor'
  | 'too_far'
  | 'dead'
  | 'cooldown'
  | 'nothing_to_bank'
  | 'round_over'
  | 'not_available';

/** What using an anchor did. `open_task` tells the client to open the SQL panel on this reward. */
export type InteractResult =
  | { readonly action: 'moved'; readonly storey: number }
  | { readonly action: 'banking'; readonly seconds: number }
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

/** A cash bag lying in the world. */
export interface BagView {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly amount: number;
}

/** Bags that appeared or vanished. The full list (all in `add`) goes to a player who joins. */
export interface LootMessage {
  readonly t: 'loot';
  readonly add: readonly BagView[];
  readonly remove: readonly number[];
}

/** The receiving player's own purse; sent when it changes. */
export interface PurseMessage {
  readonly t: 'purse';
  readonly carried: number;
  readonly banked: number;
  /** Top-speed multiplier the server applies for the cash carried; the client predicts with the same. */
  readonly speed: number;
}

/** Progress of banking cash at a safehouse (a few seconds standing still, broken by damage). */
export type BankingMessage =
  | { readonly t: 'banking'; readonly status: 'started'; readonly seconds: number }
  | { readonly t: 'banking'; readonly status: 'done'; readonly amount: number }
  | { readonly t: 'banking'; readonly status: 'cancelled'; readonly reason: BankingCancel };

export type BankingCancel = 'hurt' | 'moved' | 'died' | 'round_over';

/** The guns a player owns this life, and the one in hand (ammo travels in snapshots). */
export interface ArmsMessage {
  readonly t: 'arms';
  readonly owned: readonly string[];
  readonly current: string;
}

/**
 * Every gun's numbers, on join and whenever an admin retunes them (at a new
 * round): the client predicts fire rate and range, zooms and kicks the view
 * with these, so they must be the server's, not the client's defaults.
 */
export interface WeaponsMessage {
  readonly t: 'weapons';
  readonly weapons: Readonly<Record<string, WeaponSpec>>;
}

/** One line of the scoreboard. */
export interface StandingView {
  readonly id: number;
  readonly name: string;
  readonly banked: number;
  readonly kills: number;
}

/** The leaders. Broadcast every few seconds; each player also learns their own rank (`standing`). */
export interface ScoresMessage {
  readonly t: 'scores';
  readonly top: readonly StandingView[];
  readonly players: number;
}

export interface StandingMessage {
  readonly t: 'standing';
  readonly rank: number;
  readonly players: number;
}

/**
 * Round state. `playing`: the round ends in `endsInSec`. `ended`: the final
 * standings, who won, and when the next round starts.
 */
export type RoundMessage =
  | { readonly t: 'round'; readonly phase: 'playing'; readonly endsInSec: number }
  | {
      readonly t: 'round';
      readonly phase: 'ended';
      readonly nextInSec: number;
      readonly winner: StandingView | null;
      readonly standings: readonly StandingView[];
    };

/**
 * One line of the event feed everyone sees (next to the kill feed): heists in
 * progress, vaults opened, cash banked, bounties set and claimed. Names are
 * resolved by the server, so the client only shows them.
 */
export type FeedItem =
  | {
      readonly kind: 'alarm';
      readonly bank: string;
      readonly tier: number;
      readonly lock: number;
      readonly locks: number;
    }
  | {
      readonly kind: 'vault_open';
      readonly bank: string;
      readonly tier: number;
    }
  | { readonly kind: 'banked'; readonly name: string; readonly amount: number }
  | {
      readonly kind: 'wanted';
      readonly name: string;
      readonly cash: number;
      readonly reward: number;
    }
  | {
      readonly kind: 'bounty_claimed';
      readonly killer: string;
      readonly victim: string;
      readonly reward: number;
    };

export interface FeedMessage {
  readonly t: 'feed';
  readonly item: FeedItem;
}

/** A player with a price on their head, where they were when the board was last posted. */
export interface WantedView {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly cash: number;
}

/** Every wanted player, to everyone, every few seconds (and once empty when the last one goes). */
export interface BountiesMessage {
  readonly t: 'bounties';
  readonly wanted: readonly WantedView[];
  readonly reward: number;
}

/** A short message for the player ("Someone beat you to the lock"). */
export interface NoticeMessage {
  readonly t: 'notice';
  readonly text: string;
}

export type VehicleDenial =
  | 'unknown_vehicle'
  | 'too_far'
  | 'taken'
  | 'dead'
  | 'already_driving'
  | 'not_driving'
  | 'too_fast'
  | 'no_room';

/** Answer to a `vehicle` request: in (or out), or why not. */
export interface VehicleReply {
  readonly t: 'vehicle_result';
  readonly ref: number;
  readonly ok: boolean;
  readonly reason?: VehicleDenial;
}

export type HeistServerMessage =
  | InteractReply
  | VehicleReply
  | VaultsMessage
  | LootMessage
  | PurseMessage
  | BankingMessage
  | ArmsMessage
  | WeaponsMessage
  | FeedMessage
  | BountiesMessage
  | ScoresMessage
  | StandingMessage
  | RoundMessage
  | NoticeMessage;

export type JsonServerMessage = ChallengeServerMessage | HeistServerMessage;
