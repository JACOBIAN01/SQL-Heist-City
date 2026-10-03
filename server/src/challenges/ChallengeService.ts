import { randomUUID } from 'node:crypto';
import {
  SeededRng,
  seedOf,
  type Hint,
  type HintResult,
  type IssueResult,
  type PublicChallenge,
  type RunResult,
  type SubmitResult,
  type TierRange,
} from '@heist/shared';
import type { SettingsReader } from '../config/SettingsReader';
import type { Grader } from '../sql/Grader';
import { ReferenceQueryError } from '../sql/Grader';
import type { QueryResult } from '../sql/SqlSandbox';
import type { Variant, VariantBuilder } from '../variants/VariantBuilder';
import type { QuestionSelector } from './QuestionSelector';

export interface ChallengeRequest {
  readonly player: string;
  /** e.g. "heal:small", "gun:rifle", "vault:bank-2:lock-1". */
  readonly rewardKey: string;
  /** What the reward applies to (vault id, weapon slot…); echoed back on success. */
  readonly target?: string;
  /** Explicit tiers (vault locks); otherwise looked up from the reward map. */
  readonly tiers?: TierRange;
}

export interface ChallengeLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface ChallengeServiceDeps {
  readonly matchSeed: string;
  readonly selector: QuestionSelector;
  readonly variants: VariantBuilder;
  readonly grader: Grader;
  readonly settings: SettingsReader;
  readonly now?: () => number;
  readonly newId?: () => string;
  readonly logger?: ChallengeLogger;
}

/** Server-side state of one issued challenge. Never sent to clients. */
interface ActiveChallenge {
  readonly id: string;
  readonly player: string;
  readonly rewardKey: string;
  readonly target: string | null;
  readonly questionId: number;
  readonly questionVersion: number;
  readonly variant: Variant;
  readonly expected: QueryResult;
  readonly expiresAt: number;
  /** Hints of the question version this challenge was issued from. */
  readonly hints: readonly Hint[];
  readonly hintCostMode: 'fraction' | 'absolute';
  /** How many hints (in order) the player has revealed and been charged for. */
  hintsRevealed: number;
  lockedUntil: number;
  lastRunAt: number;
  lastSubmitAt: number;
  solved: boolean;
}

/** Questions to try when a reference query turns out broken for a seed. */
const MAX_ISSUE_ATTEMPTS = 3;

// Pattern: Facade — Why: match code needs three verbs (issue, run, submit).
// Behind them sit selection, seeding, variant building, sandboxed grading,
// lockouts, expiry and rate limits; the facade keeps all of that out of the
// game loop and gives one place to enforce the challenge rules.
export class ChallengeService {
  /** Active challenge per player — issuing a new one replaces it (switching task). */
  private readonly byPlayer = new Map<string, ActiveChallenge>();
  /** Per player + reward attempt counter → part of the seed, so retries get new variants. */
  private readonly attempts = new Map<string, number>();
  private readonly lastRequestAt = new Map<string, number>();
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: ChallengeServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? randomUUID;
  }

  async issue(request: ChallengeRequest): Promise<IssueResult> {
    const settings = this.deps.settings.challengeSettings();
    const now = this.now();

    const lastRequest = this.lastRequestAt.get(request.player);
    if (lastRequest !== undefined && now - lastRequest < settings.requestCooldownMs) {
      return {
        ok: false,
        reason: 'rate_limited',
        retryAt: lastRequest + settings.requestCooldownMs,
      };
    }
    const tiers = request.tiers ?? this.deps.settings.rewardTiers(request.rewardKey);
    if (!tiers) return { ok: false, reason: 'unknown_reward' };
    this.lastRequestAt.set(request.player, now);

    // Switching task: the previous challenge is dropped; its question is used up.
    this.byPlayer.delete(request.player);

    for (let i = 0; i < MAX_ISSUE_ATTEMPTS; i++) {
      const attempt = this.nextAttempt(request.player, request.rewardKey);
      const seed = seedOf(this.deps.matchSeed, request.player, request.rewardKey, attempt);
      const question = this.deps.selector.select(
        request.player,
        request.rewardKey,
        tiers,
        new SeededRng(`${seed}/select`),
      );
      if (!question) return { ok: false, reason: 'no_questions' };

      const variant = this.deps.variants.build(question.template, seed);
      let expected: QueryResult;
      try {
        expected = await this.deps.grader.expectedResult(variant);
      } catch (err) {
        if (!(err instanceof ReferenceQueryError)) throw err;
        this.deps.logger?.warn('skipping broken question', {
          slug: question.slug,
          seed,
          error: err.message,
        });
        continue;
      }

      const challenge: ActiveChallenge = {
        id: this.newId(),
        player: request.player,
        rewardKey: request.rewardKey,
        target: request.target ?? null,
        questionId: question.id,
        questionVersion: question.version,
        variant,
        expected,
        expiresAt: now + settings.ttlSec * 1000,
        hints: question.template.hints,
        hintCostMode: settings.hintCostMode,
        hintsRevealed: 0,
        lockedUntil: 0,
        lastRunAt: Number.NEGATIVE_INFINITY,
        lastSubmitAt: Number.NEGATIVE_INFINITY,
        solved: false,
      };
      this.byPlayer.set(request.player, challenge);
      return {
        ok: true,
        challenge: toPublic(challenge, settings.sampleRows),
      };
    }
    return { ok: false, reason: 'unavailable' };
  }

  /** Free preview ("Run"). Rate-limited, never locks the challenge. */
  async run(player: string, challengeId: string, sql: string): Promise<RunResult> {
    const found = this.find(player, challengeId);
    if ('reason' in found) return { ok: false, reason: found.reason };
    const challenge = found.challenge;
    const { runCooldownMs } = this.deps.settings.challengeSettings();
    const now = this.now();
    if (now - challenge.lastRunAt < runCooldownMs) {
      return { ok: false, reason: 'rate_limited', retryAt: challenge.lastRunAt + runCooldownMs };
    }
    challenge.lastRunAt = now;

    const preview = await this.deps.grader.preview(challenge.variant, sql);
    if (preview.status === 'unavailable') return { ok: false, reason: 'unavailable' };
    if (preview.status === 'error') return { ok: false, reason: 'sql', feedback: preview.feedback };
    return { ok: true, preview: preview.result };
  }

  /** Graded attempt. Wrong answers lock the challenge for `lockoutSec`. */
  async submit(player: string, challengeId: string, sql: string): Promise<SubmitResult> {
    const found = this.find(player, challengeId);
    if ('reason' in found) return { status: 'rejected', reason: found.reason };
    const challenge = found.challenge;
    const settings = this.deps.settings.challengeSettings();
    const now = this.now();
    if (now < challenge.lockedUntil)
      return { status: 'locked', lockedUntil: challenge.lockedUntil };
    if (now - challenge.lastSubmitAt < settings.submitCooldownMs) {
      return {
        status: 'rejected',
        reason: 'rate_limited',
        retryAt: challenge.lastSubmitAt + settings.submitCooldownMs,
      };
    }
    challenge.lastSubmitAt = now;

    const grade = await this.deps.grader.grade(challenge.variant, challenge.expected, sql);
    // The challenge may have been replaced or solved while grading ran.
    if (this.byPlayer.get(player) !== challenge || challenge.solved) {
      return { status: 'rejected', reason: challenge.solved ? 'already_solved' : 'not_found' };
    }
    switch (grade.status) {
      case 'correct':
        challenge.solved = true;
        this.byPlayer.delete(player);
        return { status: 'correct', rewardKey: challenge.rewardKey, target: challenge.target };
      case 'wrong':
      case 'error':
        challenge.lockedUntil = this.now() + settings.lockoutSec * 1000;
        return { status: 'wrong', feedback: grade.feedback, lockedUntil: challenge.lockedUntil };
      case 'unavailable':
        this.deps.logger?.warn('grading unavailable', { reason: grade.reason });
        return { status: 'rejected', reason: 'unavailable' };
    }
  }

  /**
   * Reveals hint `index`. Hints open in order; the first reveal is `charged`
   * (the game deducts the cost once), asking again is free and idempotent.
   */
  hint(player: string, challengeId: string, index: number): HintResult {
    const found = this.find(player, challengeId);
    if ('reason' in found) return { ok: false, reason: found.reason };
    const challenge = found.challenge;
    const hint = challenge.hints[index];
    if (!hint) return { ok: false, reason: 'no_such_hint' };
    if (index > challenge.hintsRevealed) return { ok: false, reason: 'out_of_order' };
    const charged = index === challenge.hintsRevealed;
    if (charged) challenge.hintsRevealed++;
    return {
      ok: true,
      hint: { index, text: hint.text, cost: hint.cost, costMode: challenge.hintCostMode, charged },
    };
  }

  /** Player closed the task or left; drops their challenge and rate-limit state. */
  abandon(player: string): void {
    this.byPlayer.delete(player);
  }

  forgetPlayer(player: string): void {
    this.byPlayer.delete(player);
    this.lastRequestAt.delete(player);
    for (const key of this.attempts.keys()) {
      if (key.startsWith(`${player}\0`)) this.attempts.delete(key);
    }
    this.deps.selector.forgetPlayer(player);
  }

  private find(
    player: string,
    challengeId: string,
  ): { challenge: ActiveChallenge } | { reason: 'not_found' | 'expired' } {
    const challenge = this.byPlayer.get(player);
    // Bound to (player, id): another player's id, or a replaced one, is "not found".
    if (!challenge || challenge.id !== challengeId) return { reason: 'not_found' };
    if (this.now() >= challenge.expiresAt) {
      this.byPlayer.delete(player);
      return { reason: 'expired' };
    }
    return { challenge };
  }

  private nextAttempt(player: string, rewardKey: string): number {
    const key = `${player}\0${rewardKey}`;
    const n = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, n);
    return n;
  }
}

function toPublic(c: ActiveChallenge, sampleRows: number): PublicChallenge {
  return {
    id: c.id,
    rewardKey: c.rewardKey,
    tier: c.variant.tier,
    title: c.variant.title,
    story: c.variant.story,
    schemaSql: c.variant.schemaSql,
    tables: [...c.variant.tables].map(([name, table]) => ({
      name,
      columns: table.columns,
      sampleRows: table.rows.slice(0, sampleRows),
      rowCount: table.rows.length,
    })),
    hintCosts: c.hints.map((h) => h.cost),
    hintCostMode: c.hintCostMode,
    expiresAt: c.expiresAt,
  };
}
