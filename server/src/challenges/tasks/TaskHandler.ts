import type { PublicTask, QuestionTemplate, TaskAnswer, TaskKind } from '@heist/shared';
import type { Grader } from '../../sql/Grader';
import type { Feedback } from '../../sql/FeedbackBuilder';
import type { QueryResult } from '../../sql/SqlSandbox';
import type { Variant } from '../../variants/VariantBuilder';

/** Everything a task needs about its question. */
export interface TaskContext {
  readonly template: QuestionTemplate;
  readonly variant: Variant;
  readonly grader: Grader;
}

/** What a task works out once, when the question is issued (server-only). */
export interface PreparedTask {
  /** The right rows (or the right state, for write tasks); absent for non-SQL tasks. */
  readonly expected?: QueryResult;
  /** What the pop-up shows. */
  readonly public: PublicTask;
  /** Whether the free Run button works (SQL tasks only). */
  readonly canRun: boolean;
  /** Whether a worked example (expected output) makes sense. */
  readonly hasExample: boolean;
  /** One submit only (multiple choice, fill, brief): the answer is final. */
  readonly oneGo: boolean;
}

export type TaskGrade =
  /** Passed (gets the reward); `share` below 1 when a part-marked task passed with some parts wrong. */
  | { readonly status: 'correct'; readonly share: number }
  | { readonly status: 'wrong'; readonly feedback: Feedback }
  | { readonly status: 'error'; readonly feedback: Feedback }
  | { readonly status: 'answered'; readonly feedback: Feedback; readonly share: number }
  | { readonly status: 'received' }
  | { readonly status: 'unavailable'; readonly reason: string };

export interface Submission {
  readonly sql: string;
  readonly answer?: TaskAnswer;
}

/**
 * One kind of task: how it is prepared, shown and graded.
 *
 * Pattern: Strategy (+ registry) — Why: adding a kind of question (Phase 17) is one new class
 * registered by its kind; the challenge service, socket and pop-up do not change.
 */
export interface TaskHandler {
  readonly kind: TaskKind;
  prepare(ctx: TaskContext): Promise<PreparedTask>;
  grade(ctx: TaskContext, prepared: PreparedTask, submission: Submission): Promise<TaskGrade>;
}
