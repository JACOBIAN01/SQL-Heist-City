import type { PublicTask } from '../questions/taskTypes';
/**
 * What a player's client may see about a challenge. Deliberately has no
 * reference SQL and no expected result (rules.md §2.5); the worked example
 * is computed on separate data.
 */
export type SqlCell = string | number | null;

export interface PublicTable {
  readonly name: string;
  readonly columns: readonly string[];
  readonly sampleRows: readonly (readonly SqlCell[])[];
  readonly rowCount: number;
}

/**
 * A worked example, LeetCode style: the player's own question (same
 * parameters) run on separate example data, never on the real tables, so the
 * output shows the shape of the answer without being the answer.
 */
export interface WorkedExampleView {
  readonly tables: readonly PublicTable[];
  readonly output: {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly SqlCell[])[];
    readonly rowCount: number;
  };
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
  /** Expected output: its columns and an example (absent only if the example could not be built). */
  readonly example?: WorkedExampleView;
  /** Whether the answer's column names must match (otherwise only their order does). */
  readonly columnsMatter: boolean;
  /** Whether the rows must come in a particular order. */
  readonly orderMatters: boolean;
  /** The reference query, sent only in the tutorial (rules.md: the one exception). */
  readonly solution?: string;
  /** Cost of each hint, in order (as authored; see hintCostMode). Hint text is only sent when revealed. */
  readonly hintCosts: readonly number[];
  readonly hintCostMode: 'fraction' | 'absolute';
  /** Epoch ms. */
  readonly expiresAt: number;
  /** What kind of task this is, and what the pop-up shows for it (absent: write a query). */
  readonly task?: PublicTask;
}

export interface ChallengeFeedback {
  readonly code: string;
  readonly message: string;
  /** What an error usually means and what to try, in plain words. */
  readonly advice?: string;
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
  /** A one-go task answered, not fully right: no reward, and the question is over. */
  | {
      readonly status: 'answered';
      readonly feedback: ChallengeFeedback;
      /** Share of the marks earned, 0–1. */
      readonly share: number;
    }
  /** An open brief handed in for a teacher to mark. */
  | { readonly status: 'received' }
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
