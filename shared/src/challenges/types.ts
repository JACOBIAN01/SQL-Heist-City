/**
 * What a player's client may see about a challenge. Deliberately has no
 * reference SQL and no expected result (rules.md §2.5).
 */
export type SqlCell = string | number | null;

export interface PublicTable {
  readonly name: string;
  readonly columns: readonly string[];
  readonly sampleRows: readonly (readonly SqlCell[])[];
  readonly rowCount: number;
}

export interface PublicChallenge {
  readonly id: string;
  readonly rewardKey: string;
  readonly tier: number;
  readonly title: string;
  /** Markdown task description with this player's parameters filled in. */
  readonly story: string;
  readonly schemaSql: string;
  readonly tables: readonly PublicTable[];
  /** Cost of each hint, in order (as authored; see hintCostMode). Hint text is only sent when revealed. */
  readonly hintCosts: readonly number[];
  readonly hintCostMode: 'fraction' | 'absolute';
  /** Epoch ms. */
  readonly expiresAt: number;
}

export interface ChallengeFeedback {
  readonly code: string;
  readonly message: string;
}

export interface PreviewRows {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly SqlCell[])[];
  readonly truncated: boolean;
}

export type RejectReason =
  | 'unknown_reward'
  /** The game rules refuse this task right now (not at the vault, dead, already open…). */
  | 'not_allowed'
  | 'no_questions'
  | 'not_found'
  | 'expired'
  | 'already_solved'
  | 'rate_limited'
  | 'unavailable';

export type IssueResult =
  | { readonly ok: true; readonly challenge: PublicChallenge }
  | { readonly ok: false; readonly reason: RejectReason; readonly retryAt?: number };

export type RunResult =
  | { readonly ok: true; readonly preview: PreviewRows }
  | { readonly ok: false; readonly reason: 'sql'; readonly feedback: ChallengeFeedback }
  | { readonly ok: false; readonly reason: RejectReason; readonly retryAt?: number };

export type SubmitResult =
  | { readonly status: 'correct'; readonly rewardKey: string; readonly target: string | null }
  | {
      readonly status: 'wrong';
      readonly feedback: ChallengeFeedback;
      /** Epoch ms until the next submit is accepted. */
      readonly lockedUntil: number;
    }
  | { readonly status: 'locked'; readonly lockedUntil: number }
  | { readonly status: 'rejected'; readonly reason: RejectReason; readonly retryAt?: number };

/** A hint the server has revealed. */
export interface HintReveal {
  readonly index: number;
  readonly text: string;
  readonly cost: number;
  readonly costMode: 'fraction' | 'absolute';
  /**
   * True the first time this hint is revealed: the game charges `cost` once.
   * Asking again for the same hint is free and returns `charged: false`.
   */
  readonly charged: boolean;
}

export type HintResult =
  | { readonly ok: true; readonly hint: HintReveal }
  | { readonly ok: false; readonly reason: 'no_such_hint' | 'out_of_order' | RejectReason };
