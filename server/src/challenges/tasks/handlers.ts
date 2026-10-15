import { SeededRng, normaliseBlank, type QuestionTask, type TaskKind } from '@heist/shared';
import { ReferenceQueryError } from '../../sql/Grader';
import { renderTemplate } from '../../variants/render';
import type { PreparedTask, Submission, TaskContext, TaskGrade, TaskHandler } from './TaskHandler';

type Task<K extends TaskKind> = Extract<QuestionTask, { kind: K }>;
/** SQL tasks always prepare their expected rows. */
const expectedOf = (p: PreparedTask) => {
  if (!p.expected) throw new Error('task prepared without its expected result');
  return p.expected;
};
const taskOf = <K extends TaskKind>(ctx: TaskContext) => ctx.template.task as Task<K>;
const render = (ctx: TaskContext, text: string) => renderTemplate(text, ctx.variant.params);

/** Write a query: today's kind (Solve). */
class WriteTask implements TaskHandler {
  readonly kind: TaskKind = 'write';

  async prepare(ctx: TaskContext): Promise<PreparedTask> {
    return {
      expected: await ctx.grader.expectedResult(ctx.variant),
      public: this.publicPart(ctx),
      canRun: true,
      hasExample: true,
      oneGo: false,
    };
  }

  protected publicPart(_ctx: TaskContext): PreparedTask['public'] {
    return { kind: 'write' };
  }

  async grade(ctx: TaskContext, prepared: PreparedTask, s: Submission): Promise<TaskGrade> {
    const g = await ctx.grader.grade(ctx.variant, expectedOf(prepared), s.sql);
    return g.status === 'correct' ? { status: 'correct', share: 1 } : g;
  }
}

/** Fix the query: a broken one is given and put in the editor (Solve). */
class FixTask extends WriteTask {
  override readonly kind: TaskKind = 'fix';

  protected override publicPart(ctx: TaskContext): PreparedTask['public'] {
    return { kind: 'fix', brokenSql: render(ctx, taskOf<'fix'>(ctx).broken_sql) };
  }
}

/** Make it faster: right rows, and at most `max_scans` full table scans in the plan (Solve). */
class FasterTask extends WriteTask {
  override readonly kind: TaskKind = 'faster';

  protected override publicPart(ctx: TaskContext): PreparedTask['public'] {
    const t = taskOf<'faster'>(ctx);
    return { kind: 'faster', slowSql: render(ctx, t.slow_sql), maxScans: t.max_scans };
  }

  override async grade(
    ctx: TaskContext,
    prepared: PreparedTask,
    s: Submission,
  ): Promise<TaskGrade> {
    const rows = await super.grade(ctx, prepared, s);
    if (rows.status !== 'correct') return rows;
    const plan = await ctx.grader.plan(ctx.variant, s.sql);
    if (plan.status !== 'ok')
      return plan.status === 'unavailable' ? plan : { status: 'error', feedback: plan.feedback };
    const scans = plan.lines.filter((l) => /^SCAN /.test(l)).length;
    const max = taskOf<'faster'>(ctx).max_scans;
    if (scans <= max) return { status: 'correct', share: 1 };
    return {
      status: 'wrong',
      feedback: {
        code: 'too_slow',
        message: `Right rows, but your plan reads ${scans} table${scans === 1 ? '' : 's'} from end to end (at most ${max} allowed). Let an index do the work: filter or join on an indexed column.`,
      },
    };
  }
}

/** Write to the database: graded by the state it leaves, seen through `check_sql` (Solve). */
class WriteDbTask implements TaskHandler {
  readonly kind: TaskKind = 'write_db';

  async prepare(ctx: TaskContext): Promise<PreparedTask> {
    const check = render(ctx, taskOf<'write_db'>(ctx).check_sql);
    const state = await ctx.grader.stateAfter(ctx.variant, ctx.variant.referenceSql, check);
    if (state.status !== 'ok')
      throw new ReferenceQueryError(
        ctx.variant.slug,
        ctx.variant.seed,
        state.status === 'unavailable' ? state.reason : state.feedback.message,
      );
    return {
      expected: state.result,
      public: { kind: 'write_db' },
      canRun: true,
      hasExample: false,
      oneGo: false,
    };
  }

  async grade(ctx: TaskContext, prepared: PreparedTask, s: Submission): Promise<TaskGrade> {
    const check = render(ctx, taskOf<'write_db'>(ctx).check_sql);
    const g = await ctx.grader.gradeState(ctx.variant, expectedOf(prepared), s.sql, check);
    return g.status === 'correct' ? { status: 'correct', share: 1 } : g;
  }
}

/**
 * The options of part `i` in the order this player sees them. The client gets positional ids
 * ("1", "2"…), so neither the order nor the author's ids tell two players which one is right.
 */
function optionsSeen(ctx: TaskContext, i: number) {
  const t = taskOf<'choice'>(ctx);
  const part = t.parts[i] as Task<'choice'>['parts'][number];
  return t.shuffle
    ? new SeededRng(`${ctx.variant.seed}/options/${i}`).shuffle(part.options)
    : [...part.options];
}

/** Pick the right options (Recall, Comprehend or Evaluate); one go, marks by part. */
class ChoiceTask implements TaskHandler {
  readonly kind: TaskKind = 'choice';

  async prepare(ctx: TaskContext): Promise<PreparedTask> {
    const t = taskOf<'choice'>(ctx);
    const shownSql = t.show_sql ? render(ctx, t.show_sql) : undefined;
    let shown: Extract<PreparedTask['public'], { kind: 'choice' }>['shown'];
    if (shownSql && t.show === 'result') {
      const r = await ctx.grader.preview(ctx.variant, shownSql, 12);
      if (r.status !== 'ok')
        throw new ReferenceQueryError(ctx.variant.slug, ctx.variant.seed, 'shown query failed');
      shown = { kind: 'result', columns: r.result.columns, rows: r.result.rows };
    } else if (shownSql && t.show === 'error') {
      const r = await ctx.grader.preview(ctx.variant, shownSql, 1);
      if (r.status !== 'error')
        throw new ReferenceQueryError(
          ctx.variant.slug,
          ctx.variant.seed,
          'shown query should fail',
        );
      shown = { kind: 'error', message: r.feedback.message };
    } else if (shownSql && t.show === 'plan') {
      const r = await ctx.grader.plan(ctx.variant, shownSql);
      if (r.status !== 'ok')
        throw new ReferenceQueryError(
          ctx.variant.slug,
          ctx.variant.seed,
          'shown query has no plan',
        );
      shown = { kind: 'plan', lines: r.lines };
    }
    return {
      public: {
        kind: 'choice',
        ...(shownSql ? { shownSql } : {}),
        ...(shown ? { shown } : {}),
        parts: t.parts.map((p, i) => ({
          prompt: render(ctx, p.prompt_md),
          options: optionsSeen(ctx, i).map((o, n) => ({
            id: String(n + 1),
            text: render(ctx, o.text_md),
          })),
          multi: p.multi,
        })),
      },
      canRun: false,
      hasExample: false,
      oneGo: true,
    };
  }

  async grade(ctx: TaskContext, _p: PreparedTask, s: Submission): Promise<TaskGrade> {
    const t = taskOf<'choice'>(ctx);
    const picked = s.answer?.choices ?? [];
    let earned = 0;
    let total = 0;
    let right = 0;
    t.parts.forEach((part, i) => {
      total += part.weight;
      const seen = optionsSeen(ctx, i);
      const mine = new Set((picked[i] ?? []).map((n) => seen[Number(n) - 1]?.id ?? '?'));
      const correct = new Set(part.correct);
      const exact = mine.size === correct.size && [...mine].every((c) => correct.has(c));
      if (exact) {
        earned += part.weight;
        right++;
      }
    });
    const share = Math.round((earned / total) * 100) / 100;
    if (share >= t.pass_share) return { status: 'correct', share };
    const message =
      t.parts.length === 1
        ? 'Not the right answer. The review after the round explains it.'
        : `${right} of ${t.parts.length} parts right.`;
    return { status: 'answered', share, feedback: { code: 'partial', message } };
  }
}

/** Fill the blanks (Recall); one go. */
class FillTask implements TaskHandler {
  readonly kind: TaskKind = 'fill';

  async prepare(ctx: TaskContext): Promise<PreparedTask> {
    const t = taskOf<'fill'>(ctx);
    return {
      public: { kind: 'fill', textSql: render(ctx, t.text_sql), blanks: t.blanks.length },
      canRun: false,
      hasExample: false,
      oneGo: true,
    };
  }

  async grade(ctx: TaskContext, _p: PreparedTask, s: Submission): Promise<TaskGrade> {
    const t = taskOf<'fill'>(ctx);
    const typed = s.answer?.blanks ?? [];
    const right = t.blanks.filter((b, i) =>
      b.accept.some((a) => normaliseBlank(a) === normaliseBlank(typed[i] ?? '')),
    ).length;
    const share = Math.round((right / t.blanks.length) * 100) / 100;
    if (share === 1) return { status: 'correct', share: 1 };
    return {
      status: 'answered',
      share,
      feedback: {
        code: 'partial',
        message: `${right} of ${t.blanks.length} blank${t.blanks.length === 1 ? '' : 's'} right.`,
      },
    };
  }
}

/** An open brief (Build): handed in, marked later by a teacher against the rubric. */
class BriefTask implements TaskHandler {
  readonly kind: TaskKind = 'brief';

  async prepare(ctx: TaskContext): Promise<PreparedTask> {
    return {
      public: {
        kind: 'brief',
        rubric: taskOf<'brief'>(ctx).rubric.map((r) => ({
          criterion: r.criterion,
          marks: r.marks,
        })),
      },
      canRun: true,
      hasExample: false,
      oneGo: true,
    };
  }

  async grade(_ctx: TaskContext, _p: PreparedTask, s: Submission): Promise<TaskGrade> {
    if (!s.answer?.text || s.answer.text.trim().length < 20)
      return {
        status: 'wrong',
        feedback: {
          code: 'too_short',
          message: 'Write your goal, how you will know it worked, and your queries.',
        },
      };
    return { status: 'received' };
  }
}

const HANDLERS: Readonly<Record<TaskKind, TaskHandler>> = {
  write: new WriteTask(),
  fix: new FixTask(),
  faster: new FasterTask(),
  write_db: new WriteDbTask(),
  choice: new ChoiceTask(),
  fill: new FillTask(),
  brief: new BriefTask(),
};

export const taskHandler = (kind: TaskKind): TaskHandler => HANDLERS[kind];
