import { z } from 'zod';
import { JOB_KINDS, type JobKind } from '../config/heist';
import type { GhostTrace } from '../progress/ghost';
import type { CityTable, PublicCityRequest, PublicSplitRequest } from '../config/cityDb';
import type { AwardId } from '../config/awards';
import type { AtmosphereSettings } from '../config/atmosphere';
import type { WeaponSpec } from '../config/combat';
import type { AxisScore } from '../analytics/profile';
import type { ProgressView } from '../progress/xp';
import type { SkillView } from '../progress/skills';
import type { ContractView } from '../progress/contracts';
import type { SeasonView } from '../progress/season';
import type { CosmeticView, LookChoice, LookView } from '../progress/cosmetics';
import { COSMETIC_SLOTS } from '../config/progression';
import type { SquadAwardView } from '../config/squadAwards';
import { SQUAD_ROLES, type SquadMode, type SquadRole } from '../classes/class';
import type { VehicleSettings } from '../config/vehicles';
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

/** Wear a cosmetic in a slot, or take it off (Phase 26.3). The server checks it is unlocked. */
export const setLookMessageSchema = z.object({
  t: z.literal('set_look'),
  slot: z.enum(COSMETIC_SLOTS),
  id: z.string().max(60).nullable(),
});
export type SetLookMessage = z.infer<typeof setLookMessageSchema>;

/** The owner's wardrobe: every cosmetic, which are unlocked, and what is worn. */
export interface WardrobeMessage {
  readonly t: 'wardrobe';
  readonly items: readonly CosmeticView[];
  readonly choice: LookChoice;
}

/** How everyone in the match looks, by player id. Sent when anyone joins, leaves or changes. */
export interface LooksMessage {
  readonly t: 'looks';
  readonly looks: Readonly<Record<string, LookView>>;
}

/**
 * Where a student stands in SQL Quick Draw (Phase 28.3): waiting for an opponent, the countdown,
 * a question being drawn, the pause after it, or the end of the duel. Sent on every change.
 */
export interface DuelMessage {
  readonly t: 'duel';
  readonly state: 'waiting' | 'countdown' | 'draw' | 'between' | 'over';
  readonly opponent: string | null;
  /** Points each side has won so far. */
  readonly you: number;
  readonly them: number;
  /** The draw now being played (1-based) out of how many. */
  readonly draw: number;
  readonly draws: number;
  /** Counts up with every question drawn, so the client can tell a new draw from the last. */
  readonly drawId: number;
  /** Whole seconds left in this state (countdown, draw), else 0. */
  readonly seconds: number;
  /** Who won the draw just played, once it is over. */
  readonly last?: 'you' | 'them' | 'none';
  /** The result of the duel, when it is over. */
  readonly result?: 'win' | 'lose' | 'tie';
}

/** The student's wanted level (Phase 29.4): how many stars, and the most there can be. */
export interface PoliceMessage {
  readonly t: 'police';
  readonly stars: number;
  readonly max: number;
}

/** Hidden caches this player can see right now (Phase 30.2), and the cash from one just found. */
export interface CachesMessage {
  readonly t: 'caches';
  readonly caches: readonly { readonly id: number; readonly x: number; readonly z: number }[];
  readonly found?: { readonly amount: number };
}

/**
 * The student's data-chip collection (Phase 30.3): the chips they can see now, every chip they have
 * found with its trivia, and how many there are in all. `latest` is the one just picked up.
 */
export interface CollectionMessage {
  readonly t: 'collection';
  readonly near: readonly { readonly id: number; readonly x: number; readonly z: number }[];
  readonly found: readonly { readonly id: number; readonly title: string; readonly fact: string }[];
  readonly total: number;
  readonly latest?: number;
}

/** The safehouse upgrades a student can own (Phase 30.4). */
export const UPGRADE_IDS = ['banking', 'armour', 'stash', 'intel'] as const;
export type UpgradeId = (typeof UPGRADE_IDS)[number];
export type UpgradeDenial = 'no_cash' | 'max' | 'too_far' | 'dead' | 'closed' | 'not_ready';

/** Buy the next level of a safehouse upgrade, at the shop counter. */
export const upgradeBuyMessageSchema = z.object({
  t: z.literal('upgrade_buy'),
  upgrade: z.enum(UPGRADE_IDS),
});
export type UpgradeBuyMessage = z.infer<typeof upgradeBuyMessageSchema>;

/** The districts this student has explored (Phase 30.5); the map keeps the rest under fog. */
export interface DiscoveryMessage {
  readonly t: 'discovery';
  readonly districts: readonly string[];
}

/** Take a contract from the board you are standing at (Phase 31.2). */
export const jobTakeMessageSchema = z.object({
  t: z.literal('job_take'),
  board: z.string().min(1).max(64),
  kind: z.enum(JOB_KINDS),
});
export type JobTakeMessage = z.infer<typeof jobTakeMessageSchema>;

/** The student's side job, if any (Phase 30.6). */
export interface JobMessage {
  readonly t: 'job';
  readonly kind: JobKind;
  /** `claim`: the run is done, answer the question to be paid. */
  readonly status: 'active' | 'claim' | 'done' | 'failed' | 'none';
  /** Where to go: the drop, or the checkpoints in order. */
  readonly targets: readonly { readonly x: number; readonly z: number }[];
  /** Which target is next. */
  readonly index: number;
  readonly secondsLeft: number;
  readonly reward: number;
  /** Dwelling at a target (sabotage, data theft): how far through, 0 to 1. */
  readonly dwell?: number;
}

/** Choose how to break in: quiet and slow, or loud (Phase 30.7). */
export const approachMessageSchema = z.object({
  t: z.literal('approach'),
  mode: z.enum(['loud', 'stealth']),
});
export type ApproachMessage = z.infer<typeof approachMessageSchema>;

/** Which approach the server has set for you (it only sends this to confirm). */
export interface ApproachState {
  readonly t: 'approach_state';
  readonly mode: 'loud' | 'stealth';
}

/**
 * Where you are in a three-act heist (Phase 31.1): `setup` while you gather intel, `heist` once a
 * lock is cracked, `getaway` once you carry the take, `complete` when it is banked.
 */
export interface ActsMessage {
  readonly t: 'acts';
  /** The bank this is about (`bank-3`), or none. */
  readonly bank?: string;
  readonly act: 'none' | 'setup' | 'heist' | 'getaway' | 'complete';
  /** Intel points held on that bank, and the most there are. */
  readonly intel: number;
  readonly intelMax: number;
  /** The take being carried (getaway) or banked (complete). */
  readonly take: number;
}

/**
 * What a heist came to (Phase 31.4), shown after every one: the take, what it was made of, what was
 * banked and the mastery XP it earned. `failed` is a getaway that did not make it.
 */
export interface PayoutMessage {
  readonly t: 'payout';
  readonly outcome: 'complete' | 'failed';
  readonly bank: string;
  /** Banked cash (complete) or the take that was lost (failed). */
  readonly total: number;
  readonly lines: readonly {
    readonly id: 'vault' | 'ghost' | 'intel' | 'locks' | 'other' | 'lost';
    readonly amount: number;
  }[];
  readonly mastery: number;
}

/** A ghost to race (Phase 34.6): the best run on a bank so far, replayed from the moment you begin yours. */
export interface GhostMessage {
  readonly t: 'ghost';
  readonly bank: string;
  readonly name: string;
  /** How long its heist took, and what it banked. */
  readonly seconds: number;
  readonly take: number;
  readonly mine: boolean;
  readonly trace: GhostTrace;
}

/** How your finished heist compared with the ghost (Phase 34.6). */
export interface GhostResultMessage {
  readonly t: 'ghost_result';
  readonly bank: string;
  readonly ghost?: { readonly name: string; readonly seconds: number };
  readonly seconds: number;
  readonly beat: boolean;
  /** Your run is now the ghost for everyone to beat. */
  readonly record: boolean;
}

/** One table of leanest queries for a question (Phase 34.4). */
export interface BoardSummary {
  readonly rank: number;
  readonly of: number;
  readonly top: readonly {
    readonly rank: number;
    readonly name: string;
    readonly scanned: number;
    readonly length: number;
    readonly you: boolean;
  }[];
}

/** Where a correct write query puts the student among their class and everyone (Phase 34.4). */
export interface LeaderboardMessage {
  readonly t: 'leaderboard';
  readonly question: string;
  readonly you: { readonly scanned: number; readonly length: number };
  /** This query is the student's best so far for the question. */
  readonly newBest: boolean;
  readonly class?: BoardSummary;
  readonly global: BoardSummary;
}

/** The inside man rings (Phase 34.3): fix his query in time. `done` or `missed` closes the call. */
export interface InsideMessage {
  readonly t: 'inside';
  readonly status: 'call' | 'done' | 'missed';
  readonly bank: string;
  readonly text: string;
  readonly seconds: number;
}

/** Which side you are on in a cops-and-robbers room (Phase 34.1); sent once on joining. */
export interface TeamMessage {
  readonly t: 'team';
  readonly role: 'cop' | 'robber';
}

/** Ask the city database a question: a request and the SQL the student wrote for it (Phase 33). */
export const cityQueryMessageSchema = z.object({
  t: z.literal('city_query'),
  ref: z.number().int(),
  request: z.string().min(1).max(60),
  sql: z.string().min(1).max(2000),
});
export type CityQueryMessage = z.infer<typeof cityQueryMessageSchema>;

/** The city database as a student sees it: its tables and the requests on offer (never the answers). */
export interface CityDbMessage {
  readonly t: 'citydb';
  readonly tables: readonly CityTable[];
  readonly requests: readonly PublicCityRequest[];
  readonly splits: readonly PublicSplitRequest[];
}

/** One member's part of a split query (Phase 34.2): which part, and the SQL they wrote for it. */
export const splitSubmitMessageSchema = z.object({
  t: z.literal('split_submit'),
  ref: z.number().int(),
  split: z.string().min(1).max(60),
  part: z.number().int().min(0).max(2),
  sql: z.string().min(1).max(2000),
});
export type SplitSubmitMessage = z.infer<typeof splitSubmitMessageSchema>;

/** Where a squad's split query stands: each part open, done (and by whom). Sent to the whole squad. */
export interface SplitStateMessage {
  readonly t: 'split_state';
  readonly split: string;
  readonly parts: readonly { readonly status: 'open' | 'done'; readonly by?: string }[];
  /** The lock opened: all three parts were right. */
  readonly opened?: boolean;
}

/** The answer to one `city_query`. */
export interface CityResultMessage {
  readonly t: 'city_result';
  readonly ref: number;
  readonly ok: boolean;
  readonly request: string;
  /** Why not: the SQL was wrong (see `feedback`), or the player must wait, or it is not allowed. */
  readonly reason?:
    | 'wrong'
    | 'error'
    | 'cooldown'
    | 'unknown'
    | 'busy'
    | 'not_available'
    | 'dead'
    | 'squad'
    | 'taken';
  readonly feedback?: { readonly code: string; readonly message: string; readonly advice?: string };
  /** Cooldown: seconds until it may be asked again. */
  readonly waitSeconds?: number;
  /** What the right query did: how many pins, or what was switched off or unlocked. */
  readonly result?: {
    readonly kind: 'intel' | 'camera' | 'door';
    readonly pins?: number;
    readonly seconds?: number;
    readonly effect?: string;
  };
}

/** What the student's intel shows on their map right now (Phase 33.2). */
export interface IntelPinsMessage {
  readonly t: 'intel_pins';
  readonly pins: readonly {
    readonly id: number;
    readonly x: number;
    readonly z: number;
    readonly label?: string;
    readonly secondsLeft: number;
  }[];
}

/** A cut-scene to play (Phase 32.3): a few lines said in turn. The student can skip it. */
export interface SceneMessage {
  readonly t: 'scene';
  readonly id: string;
  readonly title: string;
  readonly lines: readonly { readonly speaker: string; readonly text: string }[];
}

/** One short line from a fixer at a moment in a heist (Phase 32.3). */
export interface BarkMessage {
  readonly t: 'bark';
  readonly speaker: string;
  readonly text: string;
}

/** How far the student is through the story (Phase 32.2). */
export interface StoryMessage {
  readonly t: 'story';
  readonly chains: readonly {
    readonly bank: string;
    readonly name: string;
    readonly fixer: { readonly name: string; readonly role: string };
    readonly state: 'locked' | 'active' | 'done';
    readonly step: number;
    readonly total: number;
    /** The step to do now (the active chain). */
    readonly current?: { readonly title: string; readonly text: string };
    /** The page of evidence this chain gave (a finished chain). */
    readonly page?: string;
  }[];
  /** Pages of evidence collected, of five. */
  readonly pages: number;
  /** The bank whose chain was just finished. */
  readonly finished?: string;
}

/** Where the police have set roadblocks for you, when your intel has told you (Phase 31.3). */
export interface RoadblocksMessage {
  readonly t: 'roadblocks';
  readonly posts: readonly { readonly x: number; readonly z: number }[];
}

/** Guards of a bank you have intel on (Phase 31.1), for your map. */
export interface IntelGuardsMessage {
  readonly t: 'intel_guards';
  readonly guards: readonly { readonly x: number; readonly z: number }[];
}

/** What a street shop sells (Phase 29.6). */
export const SHOP_ITEMS = ['armour', 'ammo'] as const;
export type ShopItem = (typeof SHOP_ITEMS)[number];
export type ShopDenial = 'no_cash' | 'full' | 'too_far' | 'dead' | 'closed' | 'unknown_item';

/** Buy something at the shop you are standing at. */
export const shopBuyMessageSchema = z.object({
  t: z.literal('shop_buy'),
  item: z.enum(SHOP_ITEMS),
});
export type ShopBuyMessage = z.infer<typeof shopBuyMessageSchema>;

/** The shop's window: what is for sale and your armour; `result` answers the last purchase. */
export interface ShopMessage {
  readonly t: 'shop';
  readonly offers: readonly { readonly item: ShopItem; readonly price: number }[];
  readonly armour: number;
  readonly armourMax: number;
  /** Safehouse upgrades: level owned, the most there is, and the price of the next level (none at the top). */
  readonly upgrades: readonly {
    readonly id: UpgradeId;
    readonly level: number;
    readonly max: number;
    readonly price?: number;
  }[];
  readonly upgradeResult?: {
    readonly upgrade: UpgradeId;
    readonly ok: boolean;
    readonly reason?: UpgradeDenial;
  };
  readonly result?: { readonly item: ShopItem; readonly ok: boolean; readonly reason?: ShopDenial };
}

/** Join a squad (1…), or leave with 0 (Phase 27.2); only in classes where students pick their own. */
export const squadJoinMessageSchema = z.object({
  t: z.literal('squad_join'),
  squad: z.number().int().min(0).max(50),
});
export type SquadJoinMessage = z.infer<typeof squadJoinMessageSchema>;

/** Take a role in the squad, or give it up with null (Phase 27.3). */
export const rolePickMessageSchema = z.object({
  t: z.literal('role_pick'),
  role: z.enum(SQUAD_ROLES).nullable(),
});
export type RolePickMessage = z.infer<typeof rolePickMessageSchema>;

/** A squad-mate as the squad HUD shows them (Phase 27.4). */
export interface SquadMemberView {
  readonly id: number;
  readonly name: string;
  readonly hp: number;
  readonly alive: boolean;
  readonly x: number;
  readonly z: number;
  /** The reward the member has open in the SQL pop-up (`heal:small`, `vault:…`), if any. */
  readonly task: string | null;
  readonly you: boolean;
  readonly role: SquadRole | null;
}

/** A squad to pick in a self-pick class. */
export interface SquadChoice {
  readonly squad: number;
  readonly name: string;
  readonly members: number;
  readonly full: boolean;
}

/**
 * Where a student stands with squads: sent on joining, when anything changes, and about once a
 * second to squad members (their positions, health and tasks for the HUD).
 */
export interface SquadMessage {
  readonly t: 'squad';
  readonly mode: SquadMode;
  readonly size: number;
  /** The student's squad, 0 for none. */
  readonly squad: number;
  readonly name: string;
  /** True when this student may pick or leave a squad now. */
  readonly canPick: boolean;
  readonly choices: readonly SquadChoice[];
  readonly members: readonly SquadMemberView[];
  /** This student's role in the squad. */
  readonly role: SquadRole | null;
  /** Which roles are free, and who has the others. */
  readonly roles: readonly { readonly role: SquadRole; readonly takenBy: string | null }[];
  /** Why the last request was refused. */
  readonly denied?:
    'full' | 'not_allowed' | 'unknown_squad' | 'has_banked' | 'role_taken' | 'no_squad';
}

/** Rivals near a squad's lookout, for their minimap (Phase 27.3). */
export interface RadarMessage {
  readonly t: 'radar';
  readonly foes: readonly { readonly x: number; readonly z: number }[];
}

/** Everything a client may send as JSON. The server validates it again; this is the shape check. */
export const jsonClientMessageSchema = z.union([
  challengeClientMessageSchema,
  interactMessageSchema,
  equipMessageSchema,
  vehicleMessageSchema,
  setLookMessageSchema,
  squadJoinMessageSchema,
  rolePickMessageSchema,
  shopBuyMessageSchema,
  upgradeBuyMessageSchema,
  approachMessageSchema,
  jobTakeMessageSchema,
  cityQueryMessageSchema,
  splitSubmitMessageSchema,
]);
export type JsonClientMessage = z.infer<typeof jsonClientMessageSchema>;

export type InteractDenial =
  | 'unknown_anchor'
  | 'too_far'
  | 'dead'
  | 'cooldown'
  | 'nothing_to_bank'
  | 'round_over'
  | 'busy'
  | 'need_car'
  | 'intel_full'
  | 'not_available';

/** What using an anchor did. `open_task` tells the client to open the SQL panel on this reward. */
export type InteractResult =
  | { readonly action: 'moved'; readonly storey: number }
  | { readonly action: 'banking'; readonly seconds: number }
  | { readonly action: 'open_shop' }
  | { readonly action: 'job_started'; readonly kind: JobKind }
  | { readonly action: 'open_board'; readonly board: string; readonly kinds: readonly JobKind[] }
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
  /** The teacher closed this bank: its vault cannot be worked this match. */
  readonly closed?: boolean;
  /** The last lock fell quietly (stealth): no alarm on the map. */
  readonly quiet?: boolean;
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
  /** Loose office cash (12.1), drawn as a stack of notes and left off the minimap. */
  readonly loose?: true;
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
/** A squad's score: its members' banked cash and kills added up (Phase 27.1). */
export interface SquadStandingView {
  readonly squad: number;
  readonly name: string;
  readonly banked: number;
  readonly kills: number;
  /** Vault locks its members opened this round. */
  readonly locks: number;
  /** SQL tasks its members solved this round. */
  readonly solves: number;
  readonly members: number;
}

export interface ScoresMessage {
  readonly t: 'scores';
  readonly top: readonly StandingView[];
  readonly players: number;
  /** Squad table, when the class plays in squads. */
  readonly squads?: readonly SquadStandingView[];
}

export interface StandingMessage {
  readonly t: 'standing';
  readonly rank: number;
  readonly players: number;
}

/** An award at the end of a round: who won it, and the number that won it. */
export interface AwardView {
  readonly id: AwardId;
  readonly playerId: number;
  readonly name: string;
  readonly value: number;
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
      /** Only the awards somebody earned this round. */
      readonly awards: readonly AwardView[];
      /** Squad table, when the class plays in squads. */
      readonly squads?: readonly SquadStandingView[];
      readonly squadAwards?: readonly SquadAwardView[];
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
  | { readonly kind: 'banked'; readonly id: number; readonly name: string; readonly amount: number }
  | {
      readonly kind: 'wanted';
      readonly id: number;
      readonly name: string;
      readonly cash: number;
      readonly reward: number;
    }
  | {
      readonly kind: 'bounty_claimed';
      readonly killerId: number;
      readonly killer: string;
      readonly victimId: number;
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

/**
 * Which tutorial step the player is on (an index into TUTORIAL_STEPS; equal
 * to its length once every step is done). Sent on join and on every change.
 */
export interface TutorialMessage {
  readonly t: 'tutorial';
  readonly step: number;
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

/** One scope of a student's profile: both lenses, scored (docs/RCBSE.md §7). */
export interface ProfileScopeView {
  readonly rcsbe: readonly AxisScore[];
  readonly bloom: readonly AxisScore[];
  /** The lowest axis with enough evidence (the remediation signal), if any. */
  readonly focus?: { readonly lens: 'rcsbe' | 'bloom'; readonly dimension: string };
}

/**
 * A student's live profile, sent after each graded question. Only ever the
 * receiving student's own (docs/RCBSE.md §9, privacy).
 */
export interface ProfileMessage {
  readonly t: 'profile';
  /** Everything so far (all classes, all time). */
  readonly all: ProfileScopeView;
  /** This class's totals, in a class room. */
  readonly class?: ProfileScopeView;
  /** This round's totals. */
  readonly round?: ProfileScopeView;
  /** The axes the latest question moved, so the radar can pulse them. */
  readonly moved?: readonly { readonly lens: 'rcsbe' | 'bloom'; readonly dimension: string }[];
}

/** A signed-in student's rank and XP (Phase 26.1); sent on joining and whenever XP is earned. */
export interface ProgressMessage {
  readonly t: 'progress';
  readonly progress: ProgressView;
  /** XP just earned, and for what, so the HUD can show "+45 XP". */
  readonly gained?: {
    readonly amount: number;
    readonly why: 'solve' | 'round' | 'contract' | 'heist' | 'story';
  };
  /** What the share card may show (Phase 26.8); sent with the first progress message. */
  readonly share?: {
    readonly enabled: boolean;
    readonly showQuery: boolean;
    readonly maxQueryLines: number;
  };
}

/** The skill tree as this student stands in it (Phase 26.2); sent on joining and after each counted question. */
export interface SkillsMessage {
  readonly t: 'skills';
  readonly skills: readonly SkillView[];
}

/** Today's contracts and the day streak (Phase 26.5); sent on joining and whenever one moves. */
export interface ContractsMessage {
  readonly t: 'contracts';
  readonly day: string;
  readonly contracts: readonly ContractView[];
  /** Days in a row with a finished contract, and the extra share of contract XP it gives. */
  readonly streak: { readonly days: number; readonly bonusPct: number };
  /** Contracts this update finished (so the HUD can say so). */
  readonly completed?: readonly string[];
}

/** This week's league of the student's class (Phase 26.6): the top of the table and where they stand. */
export interface LeagueMessage {
  readonly t: 'league';
  readonly week: { readonly start: string; readonly end: string };
  readonly rows: readonly {
    readonly rank: number;
    readonly name: string;
    readonly points: number;
    readonly learningPoints: number;
    readonly cashPoints: number;
    readonly you: boolean;
  }[];
}

/** The current season and how far the student's free track has got (Phase 26.7); absent between seasons. */
export interface SeasonMessage {
  readonly t: 'season';
  readonly season?: SeasonView;
}

/** One question a student met this round, with what they wrote and the model answer. */
export interface ReviewItem {
  readonly title: string;
  readonly story: string;
  readonly outcome: string;
  readonly rewardKey: string;
  readonly tier: number;
  readonly rcsbe: string;
  readonly topics: readonly string[];
  readonly secondsOpen: number;
  readonly hintsUsed: number;
  readonly yourSql: string | null;
  readonly modelSql: string;
  /** The concept cards for the question's topics that have one. */
  readonly cards: readonly {
    readonly topic: string;
    readonly title: string;
    readonly body_md: string;
  }[];
}

/**
 * Sent to a player once, after the round has ended: every question they met,
 * their last query and the model answer. The model answers never leave the
 * server before this (docs/rules.md: no reference solutions during play).
 */
export interface ReviewMessage {
  readonly t: 'review';
  readonly round: number;
  readonly items: readonly ReviewItem[];
}

/** The numbers clients simulate and draw with (cars, time of day), sent on join and at each new round. */
export interface WorldMessage {
  readonly t: 'world';
  readonly vehicles: VehicleSettings;
  readonly atmosphere: AtmosphereSettings;
  /** Which picture each reward shows (the admin picks them). */
  readonly rewardIcons: Readonly<Record<string, string>>;
}

export type HeistServerMessage =
  | ReviewMessage
  | ProfileMessage
  | ProgressMessage
  | SkillsMessage
  | ContractsMessage
  | SquadMessage
  | PoliceMessage
  | ShopMessage
  | CachesMessage
  | CollectionMessage
  | DiscoveryMessage
  | JobMessage
  | ActsMessage
  | IntelGuardsMessage
  | RoadblocksMessage
  | StoryMessage
  | SceneMessage
  | BarkMessage
  | CityDbMessage
  | TeamMessage
  | InsideMessage
  | LeaderboardMessage
  | GhostMessage
  | GhostResultMessage
  | CityResultMessage
  | SplitStateMessage
  | IntelPinsMessage
  | PayoutMessage
  | ApproachState
  | DuelMessage
  | RadarMessage
  | LeagueMessage
  | SeasonMessage
  | WardrobeMessage
  | LooksMessage
  | WorldMessage
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
  | NoticeMessage
  | TutorialMessage;

export type JsonServerMessage = ChallengeServerMessage | HeistServerMessage;
