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
  type ItemOutcome,
  type QuestionTemplate,
  type ItemRecord,
  type SkillAdjust,
  type TierRange,
  shiftTiers,
  kindsFor,
  type WorkedExampleView,
  type TaskAnswer,
  marksFor,
  frameFor,
  queryCost,
  type QueryCost,
  ENGINE_DIALECT,
  questionQuirks,
} from '@heist/shared';
import type { AttemptEventKind, AttemptSink, AttemptWho } from '../analytics/AttemptSink';
import type { ConceptReader } from '../concepts/ConceptStore';
import type { SettingsReader } from '../config/SettingsReader';
import type { Grader } from '../sql/Grader';
import { ReferenceQueryError } from '../sql/Grader';
import type { Variant, VariantBuilder } from '../variants/VariantBuilder';
import type { QuestionSelector } from './QuestionSelector';
import { ExampleBuilder, type WorkedExample } from './ExampleBuilder';
import type { PreparedTask, TaskContext, TaskHandler } from './tasks/TaskHandler';
import { taskHandler } from './tasks/handlers';

/** How a match may want a task issued (the tutorial: always the same question, solution free). */
export interface IssueOptions {
  /** Always this question (by slug) with this seed: the same tables and parameters every time. */
  readonly fixed?: { readonly slug: string; readonly seed: string };
  /**
   * The same question and variant for everyone who asks with this seed (a duel's draw). Nobody's
   * skill easing or history applies, so both sides face exactly the same task; `maxTier` caps it.
   */
  readonly shared?: { readonly seed: string; readonly maxTier?: number };
  /** Send the reference query with the task, and make its hints free. */
  readonly revealSolution?: boolean;
  /** Whose attempt this is, for the learning record. */
  readonly who?: AttemptWho;
  /** No hints at all (an assessment measures what the student knows unaided). */
  readonly noHints?: boolean;
  /** Only questions on these topics (the practice drill); none available means no question. */
  readonly onlyTopics?: readonly string[];
  /** Topics this student is weakest at: some questions are drawn from them (spaced repetition). */
  readonly focusTopics?: readonly string[];
  /** Eases this question for a struggling student (easier tier, more time). */
  readonly skill?: SkillAdjust;
  /** Only questions with these ids may be asked (a class's released set for this kind of task). */
  readonly allowedQuestions?: ReadonlySet<number>;
  /** The class's dialect pack: its notes for this question go with it. */
  readonly dialect?: string;
}

export interface ChallengeRequest extends IssueOptions {
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
  /** Hears what happens to every issued question (the learning record). */
  readonly attempts?: AttemptSink;
  /** Concept cards, for the free steps of the hint ladder. */
  readonly concepts?: ConceptReader;
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
  /** The kind of task and what it worked out at issue (the right rows, the shown result…). */
  readonly task: {
    readonly handler: TaskHandler;
    readonly ctx: TaskContext;
    readonly prepared: PreparedTask;
  };
  /** The worked example shown with the task (separate data; safe to show). */
  readonly example: WorkedExample | undefined;
  readonly expiresAt: number;
  /** Hints of the question version this challenge was issued from. */
  readonly hints: readonly Hint[];
  readonly hintCostMode: 'fraction' | 'absolute';
  /** Tutorial: the reference query goes to the player, and hints cost nothing. */
  readonly revealSolution: boolean;
  /** The class's dialect notes for this question (sent with it). */
  readonly dialect: PublicChallenge['dialect'];
  /** How many hints (in order) the player has revealed and been charged for. */
  hintsRevealed: number;
  /** Revealed steps that cost something: only these count against the profile. */
  paidHints: number;
  lockedUntil: number;
  lastRunAt: number;
  lastSubmitAt: number;
  solved: boolean;
  // --- the learning record (docs/RCBSE.md §5.3) ---
  readonly who: AttemptWho;
  readonly issuedAt: number;
  readonly tags: {
    readonly tier: number;
    readonly rcsbe: ItemRecord['rcsbe'];
    readonly bloom: ItemRecord['bloom'];
    readonly marks: number;
    readonly topics: readonly string[];
  };
  runs: number;
  submits: number;
  wrongSubmits: number;
  lastSql: string | undefined;
  /** The handed-in write-up of an open brief. */
  briefText: string | undefined;
  finished: boolean;
}

/** When to try again while your previous Run or Submit is still being graded. */
const BUSY_RETRY_MS = 500;

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
  /**
   * Players with a Run or Submit being graded now: one job in flight each, so a flooding client
   * can hold at most one sandbox slot and never starve the class (Phase 19.3).
   */
  private readonly grading = new Set<string>();
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly examples: ExampleBuilder;

  constructor(private readonly deps: ChallengeServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? randomUUID;
    this.examples = new ExampleBuilder(deps.variants, deps.grader);
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
    const baseTiers = request.tiers ?? this.deps.settings.rewardTiers(request.rewardKey);
    if (!baseTiers) return { ok: false, reason: 'unknown_reward' };
    const skill = request.fixed || request.shared ? undefined : request.skill;
    const shiftedTiers = skill ? shiftTiers(baseTiers, skill.tierShift) : baseTiers;
    const tiers = request.shared?.maxTier
      ? {
          min: Math.min(shiftedTiers.min, request.shared.maxTier),
          max: Math.min(shiftedTiers.max, request.shared.maxTier),
        }
      : shiftedTiers;
    this.lastRequestAt.set(request.player, now);

    // Switching task: the previous challenge is dropped; its question is used up.
    const previous = this.byPlayer.get(request.player);
    if (previous) this.finish(previous, now >= previous.expiresAt ? 'expired' : 'switched');
    this.byPlayer.delete(request.player);

    for (let i = 0; i < MAX_ISSUE_ATTEMPTS; i++) {
      const attempt = this.nextAttempt(request.player, request.rewardKey);
      const fixed =
        i === 0 && request.fixed ? this.deps.selector.bySlug(request.fixed.slug) : undefined;
      if (request.fixed && i === 0 && !fixed)
        this.deps.logger?.warn('fixed question missing or disabled, picking another', {
          slug: request.fixed.slug,
        });
      const seed = request.shared
        ? i === 0
          ? request.shared.seed
          : `${request.shared.seed}#${i}`
        : fixed && request.fixed
          ? request.fixed.seed
          : seedOf(this.deps.matchSeed, request.player, request.rewardKey, attempt);
      const question = request.shared
        ? this.deps.selector.selectShared(
            tiers,
            new SeededRng(`${seed}/select`),
            request.allowedQuestions,
            kindsFor(settings, request.rewardKey),
          )
        : (fixed ??
          this.deps.selector.select(
            request.player,
            request.rewardKey,
            tiers,
            new SeededRng(`${seed}/select`),
            request.allowedQuestions,
            this.focusFor(request, seed),
            request.onlyTopics?.length ? new Set(request.onlyTopics) : undefined,
            kindsFor(settings, request.rewardKey),
          ));
      if (!question) return { ok: false, reason: 'no_questions' };

      const variant = this.deps.variants.build(question.template, seed);
      const handler = taskHandler(question.template.task.kind);
      const ctx: TaskContext = { template: question.template, variant, grader: this.deps.grader };
      let prepared: PreparedTask;
      try {
        prepared = await handler.prepare(ctx);
      } catch (err) {
        if (!(err instanceof ReferenceQueryError)) throw err;
        this.deps.logger?.warn('skipping broken question', {
          slug: question.slug,
          seed,
          error: err.message,
        });
        continue;
      }

      const example = prepared.hasExample
        ? await this.examples.build(question.template, seed, {
            rows: settings.exampleRows,
            tries: settings.exampleTries,
          })
        : undefined;
      const challenge: ActiveChallenge = {
        id: this.newId(),
        player: request.player,
        rewardKey: request.rewardKey,
        target: request.target ?? null,
        questionId: question.id,
        questionVersion: question.version,
        variant,
        task: { handler, ctx, prepared },
        example,
        expiresAt: now + settings.ttlSec * (skill?.ttlScale ?? 1) * 1000,
        // The ladder: free steps from the topic's concept card first, then the question's own paid hints
        // (the tutorial's are all free).
        hints: request.noHints
          ? []
          : this.ladder(question.template, settings.freeHintSteps, request.revealSolution === true),
        hintCostMode: settings.hintCostMode,
        revealSolution: request.revealSolution ?? false,
        dialect: this.dialectNotes(request.dialect, question.template),
        hintsRevealed: 0,
        paidHints: 0,
        lockedUntil: 0,
        lastRunAt: Number.NEGATIVE_INFINITY,
        lastSubmitAt: Number.NEGATIVE_INFINITY,
        solved: false,
        who: { ...request.who, playerKey: request.player },
        issuedAt: now,
        tags: {
          tier: question.template.tier,
          rcsbe: question.template.rcsbe,
          bloom: question.template.bloom,
          marks: marksFor(question.template, this.deps.settings.analyticsSettings()),
          topics: question.template.topic,
        },
        runs: 0,
        submits: 0,
        wrongSubmits: 0,
        lastSql: undefined,
        briefText: undefined,
        finished: false,
      };
      this.byPlayer.set(request.player, challenge);
      this.note(challenge, 'issued', { seed, attempt, tutorial: challenge.revealSolution });
      return {
        ok: true,
        challenge: toPublic(
          challenge,
          settings.sampleRows,
          settings.exampleShownRows,
          this.frameOf(challenge.rewardKey),
        ),
      };
    }
    return { ok: false, reason: 'unavailable' };
  }

  /** The story's line above a question of this reward (none in a tutorial, practice or assessment). */
  private frameOf(rewardKey: string): string | undefined {
    const story = this.deps.settings.storySettings();
    return story.enabled ? frameFor(rewardKey, story.frames) : undefined;
  }

  /** Free preview ("Run"). Rate-limited, never locks the challenge. */
  async run(player: string, challengeId: string, sql: string): Promise<RunResult> {
    const found = this.find(player, challengeId);
    if ('reason' in found) return { ok: false, reason: found.reason };
    const challenge = found.challenge;
    if (!challenge.task.prepared.canRun) return { ok: false, reason: 'not_allowed' };
    const { runCooldownMs } = this.deps.settings.challengeSettings();
    const now = this.now();
    if (now - challenge.lastRunAt < runCooldownMs) {
      return { ok: false, reason: 'rate_limited', retryAt: challenge.lastRunAt + runCooldownMs };
    }
    if (this.grading.has(player))
      return { ok: false, reason: 'rate_limited', retryAt: now + BUSY_RETRY_MS };
    challenge.lastRunAt = now;
    challenge.lastSql = sql;

    this.grading.add(player);
    let preview;
    try {
      preview = await this.deps.grader.preview(challenge.variant, sql);
    } finally {
      this.grading.delete(player);
    }
    if (preview.status !== 'unavailable') {
      challenge.runs++;
      this.note(challenge, 'run', { ok: preview.status === 'ok' });
    }
    if (preview.status === 'unavailable') return { ok: false, reason: 'unavailable' };
    if (preview.status === 'error') return { ok: false, reason: 'sql', feedback: preview.feedback };
    return { ok: true, preview: preview.result };
  }

  /** Graded attempt. Wrong answers lock the challenge for `lockoutSec`. */
  async submit(
    player: string,
    challengeId: string,
    sql: string,
    answer?: TaskAnswer,
  ): Promise<SubmitResult> {
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
    if (this.grading.has(player))
      return { status: 'rejected', reason: 'rate_limited', retryAt: now + BUSY_RETRY_MS };
    challenge.lastSubmitAt = now;
    if (sql) challenge.lastSql = sql;

    const { handler, ctx, prepared } = challenge.task;
    this.grading.add(player);
    let grade;
    try {
      grade = await handler.grade(ctx, prepared, { sql, ...(answer ? { answer } : {}) });
    } finally {
      this.grading.delete(player);
    }
    // The challenge may have been replaced or solved while grading ran.
    if (this.byPlayer.get(player) !== challenge || challenge.solved) {
      return { status: 'rejected', reason: challenge.solved ? 'already_solved' : 'not_found' };
    }
    switch (grade.status) {
      case 'correct':
        challenge.solved = true;
        challenge.submits++;
        this.note(challenge, 'submit_correct');
        this.finish(challenge, 'solved', grade.share, await this.costOf(challenge, sql));
        this.byPlayer.delete(player);
        return { status: 'correct', rewardKey: challenge.rewardKey, target: challenge.target };
      case 'answered':
        // One go: the question is over, with the share of the marks it earned and no reward.
        challenge.solved = true;
        challenge.submits++;
        challenge.wrongSubmits++;
        this.note(challenge, 'submit_wrong', { share: grade.share });
        this.finish(challenge, 'answered', grade.share);
        this.byPlayer.delete(player);
        return { status: 'answered', feedback: grade.feedback, share: grade.share };
      case 'received':
        challenge.briefText = answer?.text ?? '';
        challenge.solved = true;
        challenge.submits++;
        this.note(challenge, 'submit_correct', { brief: true });
        this.finish(challenge, 'submitted');
        this.byPlayer.delete(player);
        return { status: 'received' };
      case 'wrong':
      case 'error':
        challenge.submits++;
        challenge.wrongSubmits++;
        this.note(challenge, grade.status === 'wrong' ? 'submit_wrong' : 'submit_error');
        // A brief handed in too short is sent back without a lockout (nothing was graded).
        if (prepared.oneGo) return { status: 'wrong', feedback: grade.feedback, lockedUntil: now };
        challenge.lockedUntil = this.now() + settings.lockoutSec * 1000;
        this.note(challenge, 'lockout', { seconds: settings.lockoutSec });
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
    if (charged) {
      challenge.hintsRevealed++;
      if (hint.cost > 0) challenge.paidHints++;
      this.note(challenge, 'hint', { index, cost: hint.cost });
    }
    return {
      ok: true,
      hint: { index, text: hint.text, cost: hint.cost, costMode: challenge.hintCostMode, charged },
    };
  }

  /** Player closed the task or left; drops their challenge and rate-limit state. */
  abandon(player: string): void {
    this.end(player, 'abandoned');
  }

  /** The player was shot dead with a question open. */
  playerDied(player: string): void {
    this.end(player, 'died');
  }

  private end(player: string, outcome: ItemOutcome): void {
    const challenge = this.byPlayer.get(player);
    if (challenge) this.finish(challenge, outcome);
    this.byPlayer.delete(player);
  }

  forgetPlayer(player: string): void {
    this.end(player, 'left');
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
      this.finish(challenge, 'expired');
      this.byPlayer.delete(player);
      return { reason: 'expired' };
    }
    return { challenge };
  }

  /** Tells the learning record something happened to this question. */
  private note(
    challenge: ActiveChallenge,
    kind: AttemptEventKind,
    detail?: Record<string, unknown>,
  ): void {
    this.deps.attempts?.event({
      at: this.now(),
      kind,
      challengeId: challenge.id,
      who: challenge.who,
      questionId: challenge.questionId,
      rewardKey: challenge.rewardKey,
      ...(detail ? { detail } : {}),
    });
  }

  /** A question ended, one way or another: the record is complete, report it once. */
  /** How lean a correct write-task query was: its plan priced against the tables, and its length. */
  private async costOf(challenge: ActiveChallenge, sql: string): Promise<QueryCost | undefined> {
    if (!sql || challenge.revealSolution || challenge.task.ctx.template.task.kind !== 'write')
      return undefined;
    try {
      const plan = await this.deps.grader.plan(challenge.variant, sql);
      if (plan.status !== 'ok') return undefined;
      const rows = Object.fromEntries(
        [...challenge.variant.tables].map(([name, t]) => [name, t.rows.length]),
      );
      return queryCost(plan.lines, rows, sql);
    } catch {
      return undefined;
    }
  }

  private finish(
    challenge: ActiveChallenge,
    outcome: ItemOutcome,
    share?: number,
    cost?: QueryCost,
  ): void {
    if (challenge.finished) return;
    challenge.finished = true;
    const at = this.now();
    if (outcome !== 'solved' && outcome !== 'answered' && outcome !== 'submitted') {
      const kind: Record<string, AttemptEventKind> = {
        abandoned: 'abandon',
        expired: 'expire',
        switched: 'switch',
        died: 'death',
        left: 'leave',
      };
      this.note(challenge, kind[outcome] as AttemptEventKind);
    }
    this.deps.attempts?.item(
      {
        challengeId: challenge.id,
        ...(challenge.who.accountId === undefined ? {} : { accountId: challenge.who.accountId }),
        ...(challenge.who.classId === undefined ? {} : { classId: challenge.who.classId }),
        ...(challenge.who.round === undefined ? {} : { round: challenge.who.round }),
        ...(challenge.who.assessment === undefined ? {} : { assessment: challenge.who.assessment }),
        questionId: challenge.questionId,
        questionVersion: challenge.questionVersion,
        rewardKey: challenge.rewardKey,
        tier: challenge.tags.tier,
        rcsbe: challenge.tags.rcsbe,
        bloom: challenge.tags.bloom,
        marks: challenge.tags.marks,
        topics: challenge.tags.topics,
        outcome,
        ...(share === undefined || share === 1 ? {} : { share }),
        ...(cost ? { cost } : {}),
        ...(outcome === 'submitted' && challenge.task.ctx.template.task.kind === 'brief'
          ? {
              brief: {
                text: challenge.briefText ?? '',
                sql: challenge.lastSql ?? '',
                rubric: challenge.task.ctx.template.task.rubric,
              },
            }
          : {}),
        runs: challenge.runs,
        submits: challenge.submits,
        wrongSubmits: challenge.wrongSubmits,
        hintsPaid: challenge.paidHints,
        secondsOpen: Math.max(0, (at - challenge.issuedAt) / 1000),
        tutorial: challenge.revealSolution,
        issuedAt: challenge.issuedAt,
        finishedAt: at,
        review: {
          title: challenge.variant.title,
          story: challenge.variant.story,
          ...(challenge.lastSql === undefined ? {} : { lastSql: challenge.lastSql }),
          modelSql: challenge.variant.referenceSql,
        },
      },
      challenge.who,
    );
  }

  /** The class's dialect pack, with the entries this question's SQL touches marked; none for SQLite. */
  private dialectNotes(
    id: string | undefined,
    template: QuestionTemplate,
  ): PublicChallenge['dialect'] {
    if (!id || id === ENGINE_DIALECT) return undefined;
    const pack = this.deps.settings.dialectSettings().packs[id];
    if (!pack) return undefined;
    const here = new Set<string>(questionQuirks(template));
    const entries = Object.entries(pack.entries).flatMap(([quirk, e]) =>
      e ? [{ quirk, ...e, here: here.has(quirk) }] : [],
    );
    // What this question touches comes first.
    entries.sort((a, b) => Number(b.here) - Number(a.here));
    return { name: pack.name, intro: pack.intro, entries };
  }

  /** The weak topics to draw from this time, decided by the spaced-repetition chance (seeded, so tests repeat). */
  private focusFor(request: ChallengeRequest, seed: string): ReadonlySet<string> | undefined {
    const spaced = this.deps.settings.analyticsSettings().spaced;
    if (!spaced.enabled || !request.focusTopics?.length || request.fixed) return undefined;
    return new SeededRng(`${seed}/focus`).bool(spaced.chance)
      ? new Set(request.focusTopics)
      : undefined;
  }

  /** The hint ladder for a question: a free nudge, the free concept card, then its paid hints. */
  private ladder(template: QuestionTemplate, freeSteps: number, tutorial: boolean): Hint[] {
    const own = template.hints.map((h) => (tutorial ? { ...h, cost: 0 } : h));
    if (freeSteps === 0 || !this.deps.concepts) return own;
    const card = template.topic.map((t) => this.deps.concepts?.get(t)).find((c) => c !== undefined);
    if (!card) return own;
    const free: Hint[] = [{ text: card.nudge, cost: 0 }];
    if (freeSteps >= 2) free.push({ text: `${card.title}\n${card.body_md}`, cost: 0 });
    return [...free, ...own];
  }

  private nextAttempt(player: string, rewardKey: string): number {
    const key = `${player}\0${rewardKey}`;
    const n = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, n);
    return n;
  }
}

function toPublic(
  c: ActiveChallenge,
  sampleRows: number,
  shownRows: number,
  frame?: string,
): PublicChallenge {
  // Answering from the tables alone (predict the output, fill, choose) needs them in full: show as
  // many rows as a worked example does.
  const rows = c.task.prepared.canRun ? sampleRows : Math.max(sampleRows, shownRows);
  return {
    id: c.id,
    rewardKey: c.rewardKey,
    tier: c.variant.tier,
    title: c.variant.title,
    story: c.variant.story,
    ...(frame ? { frame } : {}),
    schemaSql: c.variant.schemaSql,
    tables: [...c.variant.tables].map(([name, table]) => ({
      name,
      columns: table.columns,
      sampleRows: table.rows.slice(0, rows),
      rowCount: table.rows.length,
    })),
    ...(c.example ? { example: toExampleView(c.example, shownRows) } : {}),
    columnsMatter: c.variant.compare.names,
    orderMatters: c.variant.orderMatters,
    ...(c.revealSolution && c.variant.referenceSql ? { solution: c.variant.referenceSql } : {}),
    ...(c.task.prepared.public.kind === 'write' ? {} : { task: c.task.prepared.public }),
    ...(c.dialect ? { dialect: c.dialect } : {}),
    hintCosts: c.hints.map((h) => h.cost),
    hintCostMode: c.hintCostMode,
    expiresAt: c.expiresAt,
  };
}

/** The example as the client sees it: the first rows of each table and of the output. */
function toExampleView(e: WorkedExample, shownRows: number): WorkedExampleView {
  return {
    tables: [...e.tables].map(([name, table]) => ({
      name,
      columns: table.columns,
      sampleRows: table.rows.slice(0, shownRows),
      rowCount: table.rows.length,
    })),
    output: {
      columns: e.output.columns,
      rows: e.output.rows.slice(0, shownRows),
      rowCount: e.output.rows.length,
    },
  };
}
