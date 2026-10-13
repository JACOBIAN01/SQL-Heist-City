import {
  BLOOM_LEVELS,
  RCSBE_DIMENSIONS,
  axisScores,
  type AnalyticsSettings,
  type AxisScore,
  type Lens,
  type ProfileTotals,
} from '@heist/shared';
import type { StoredItem } from './AttemptStore';

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** What a student has done on one topic (docs/RCBSE.md §7, drill-down; also feeds skill-scaled difficulty). */
export interface TopicMastery {
  readonly topic: string;
  readonly earned: number;
  readonly available: number;
  readonly items: number;
  readonly solved: number;
  /** 0–100, or null when there are fewer than `minItems` counted items. */
  readonly score: number | null;
}

/** Marks pooled per topic over counted items. A question with several topics counts toward each. */
export function topicMastery(
  items: readonly StoredItem[],
  settings: AnalyticsSettings,
): TopicMastery[] {
  const by = new Map<
    string,
    { earned: number; available: number; items: number; solved: number }
  >();
  for (const i of items) {
    if (!i.counted) continue;
    for (const topic of i.topics) {
      const t = by.get(topic) ?? { earned: 0, available: 0, items: 0, solved: 0 };
      t.earned += i.earned;
      t.available += i.available;
      t.items += 1;
      if (i.outcome === 'solved') t.solved += 1;
      by.set(topic, t);
    }
  }
  return [...by]
    .map(([topic, t]) => ({
      topic,
      earned: round2(t.earned),
      available: round2(t.available),
      items: t.items,
      solved: t.solved,
      score:
        t.items >= settings.minItems && t.available > 0
          ? round1((t.earned / t.available) * 100)
          : null,
    }))
    .sort((a, b) => a.topic.localeCompare(b.topic));
}

/** The weakest topics with enough evidence, lowest first: where to practise next. */
export const weakestTopics = (mastery: readonly TopicMastery[], count = 3): TopicMastery[] =>
  mastery
    .filter((m) => m.score !== null)
    .sort((a, b) => (a.score as number) - (b.score as number) || a.topic.localeCompare(b.topic))
    .slice(0, count);

export interface Spread {
  readonly dimension: string;
  /** Students with enough evidence on this axis. */
  readonly students: number;
  readonly min: number | null;
  readonly q1: number | null;
  readonly median: number | null;
  readonly q3: number | null;
  readonly max: number | null;
}

/** How a class is spread on each axis: is a low score one student or everyone? */
export function classSpread(
  students: readonly { scores: readonly AxisScore[] }[],
  dimensions: readonly string[],
): Spread[] {
  return dimensions.map((dimension, i) => {
    const values = students
      .map((s) => s.scores[i]?.score)
      .filter((v): v is number => v !== null && v !== undefined)
      .sort((a, b) => a - b);
    const q = (p: number) => {
      if (values.length === 0) return null;
      const pos = (values.length - 1) * p;
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      return round1(
        (values[lo] as number) + ((values[hi] as number) - (values[lo] as number)) * (pos - lo),
      );
    };
    return {
      dimension,
      students: values.length,
      min: q(0),
      q1: q(0.25),
      median: q(0.5),
      q3: q(0.75),
      max: q(1),
    };
  });
}

/** Pooled marks of many students: a class profile (marks added, never averaged percentages). */
export function poolTotals(all: readonly ProfileTotals[]): ProfileTotals {
  const rcsbe = Object.fromEntries(
    RCSBE_DIMENSIONS.map((d) => [d, { earned: 0, available: 0, items: 0 }]),
  ) as Record<
    (typeof RCSBE_DIMENSIONS)[number],
    { earned: number; available: number; items: number }
  >;
  const bloom = Object.fromEntries(
    BLOOM_LEVELS.map((b) => [b, { earned: 0, available: 0, items: 0 }]),
  ) as Record<(typeof BLOOM_LEVELS)[number], { earned: number; available: number; items: number }>;
  for (const t of all) {
    for (const d of RCSBE_DIMENSIONS) {
      rcsbe[d] = {
        earned: round2(rcsbe[d].earned + t.rcsbe[d].earned),
        available: round2(rcsbe[d].available + t.rcsbe[d].available),
        items: rcsbe[d].items + t.rcsbe[d].items,
      };
    }
    for (const b of BLOOM_LEVELS) {
      bloom[b] = {
        earned: round2(bloom[b].earned + t.bloom[b].earned),
        available: round2(bloom[b].available + t.bloom[b].available),
        items: bloom[b].items + t.bloom[b].items,
      };
    }
  }
  return { rcsbe, bloom };
}

/** Student order for the teacher's grid: weakest dimension first (students with no evidence last). */
export function weakestFirst<T extends { scores: readonly AxisScore[] }>(
  students: readonly T[],
): T[] {
  const weakness = (s: T) => {
    const known = s.scores.map((a) => a.score).filter((v): v is number => v !== null);
    return known.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...known);
  };
  return [...students].sort((a, b) => weakness(a) - weakness(b));
}

export interface ItemAnalysis {
  readonly questionId: number;
  readonly rcsbe: string;
  readonly tier: number;
  /** Counted attempts (one per student per issue). */
  readonly attempts: number;
  readonly students: number;
  readonly solveRate: number;
  readonly wrongRate: number;
  readonly medianSeconds: number | null;
  /** How well it separates strong from weak students on its own dimension: top third's solve rate minus bottom third's. */
  readonly discrimination: number | null;
  readonly flags: readonly (
    'too_hard' | 'too_easy' | 'slow' | 'weak_separation' | 'few_attempts'
  )[];
}

export interface ItemAnalysisRules {
  readonly minAttempts: number;
  readonly tooHard: number;
  readonly tooEasy: number;
  readonly slowSeconds: number;
  readonly minDiscrimination: number;
}

export const DEFAULT_ITEM_RULES: ItemAnalysisRules = {
  minAttempts: 5,
  tooHard: 0.2,
  tooEasy: 0.95,
  slowSeconds: 150,
  minDiscrimination: 0.1,
};

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return round1(
    s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2,
  );
};

/** Per-question quality numbers from a class's (or all) finished items (docs/RCBSE.md §7, item analysis). */
export function itemAnalysis(
  items: readonly StoredItem[],
  rules: ItemAnalysisRules = DEFAULT_ITEM_RULES,
): ItemAnalysis[] {
  const counted = items.filter((i) => i.counted && i.accountId !== undefined);
  // A student's strength on a dimension: their share of marks there over every *other* question
  // (leaving the question itself out, or a question would "predict" its own result).
  const strength = new Map<string, { earned: number; available: number }>();
  const own = new Map<string, { earned: number; available: number }>();
  const add = (m: Map<string, { earned: number; available: number }>, k: string, i: StoredItem) => {
    const s = m.get(k) ?? { earned: 0, available: 0 };
    s.earned += i.earned;
    s.available += i.available;
    m.set(k, s);
  };
  for (const i of counted) {
    add(strength, `${i.accountId}|${i.rcsbe}`, i);
    add(own, `${i.accountId}|${i.rcsbe}|${i.questionId}`, i);
  }
  const byQuestion = new Map<number, StoredItem[]>();
  for (const i of counted)
    byQuestion.set(i.questionId, [...(byQuestion.get(i.questionId) ?? []), i]);

  return [...byQuestion]
    .map(([questionId, list]) => {
      const first = list[0] as StoredItem;
      const solved = list.filter((i) => i.outcome === 'solved');
      const students = new Set(list.map((i) => i.accountId)).size;
      const score = (i: StoredItem) => {
        const all = strength.get(`${i.accountId}|${i.rcsbe}`);
        const mine = own.get(`${i.accountId}|${i.rcsbe}|${i.questionId}`);
        if (!all || !mine) return 0;
        const available = all.available - mine.available;
        return available > 0 ? (all.earned - mine.earned) / available : 0;
      };
      const ranked = [...list].sort((a, b) => score(a) - score(b));
      const third = Math.max(1, Math.floor(ranked.length / 3));
      const rate = (xs: readonly StoredItem[]) =>
        xs.filter((i) => i.outcome === 'solved').length / xs.length;
      const discrimination =
        ranked.length >= rules.minAttempts
          ? round2(rate(ranked.slice(-third)) - rate(ranked.slice(0, third)))
          : null;
      const solveRate = round2(solved.length / list.length);
      const medianSeconds = median(solved.map((i) => i.secondsOpen));
      const flags: ItemAnalysis['flags'][number][] = [];
      if (list.length < rules.minAttempts) flags.push('few_attempts');
      else {
        if (solveRate < rules.tooHard) flags.push('too_hard');
        if (solveRate > rules.tooEasy) flags.push('too_easy');
        if (medianSeconds !== null && medianSeconds > rules.slowSeconds) flags.push('slow');
        if (
          discrimination !== null &&
          discrimination < rules.minDiscrimination &&
          solveRate < rules.tooEasy
        )
          flags.push('weak_separation');
      }
      return {
        questionId,
        rcsbe: first.rcsbe,
        tier: first.tier,
        attempts: list.length,
        students,
        solveRate,
        wrongRate: round2(list.filter((i) => i.wrongSubmits > 0).length / list.length),
        medianSeconds,
        discrimination,
        flags,
      };
    })
    .sort((a, b) => a.questionId - b.questionId);
}

/** One row per student × axis, for a spreadsheet (docs/RCBSE.md §7). */
export function profilesCsv(
  className: string,
  rows: readonly { studentId: number; name: string; totals: ProfileTotals }[],
  settings: AnalyticsSettings,
): string {
  const lines: string[][] = [
    [
      'class',
      'student_id',
      'student',
      'lens',
      'dimension',
      'marks_earned',
      'marks_available',
      'items',
      'score_percent',
      'enough_evidence',
    ],
  ];
  for (const r of rows)
    for (const lens of ['rcsbe', 'bloom'] as Lens[])
      for (const a of axisScores(r.totals, lens, settings))
        lines.push([
          className,
          String(r.studentId),
          r.name,
          lens,
          a.dimension,
          String(a.earned),
          String(a.available),
          String(a.items),
          a.score === null ? '' : String(a.score),
          a.enough ? 'yes' : 'no',
        ]);
  return csvOf(lines);
}

/** One row per question for a class, for a spreadsheet. */
export function itemsCsv(analysis: readonly ItemAnalysis[]): string {
  return csvOf([
    [
      'question_id',
      'rcsbe',
      'tier',
      'attempts',
      'students',
      'solve_rate',
      'wrong_rate',
      'median_seconds',
      'discrimination',
      'flags',
    ],
    ...analysis.map((a) => [
      String(a.questionId),
      a.rcsbe,
      String(a.tier),
      String(a.attempts),
      String(a.students),
      String(a.solveRate),
      String(a.wrongRate),
      a.medianSeconds === null ? '' : String(a.medianSeconds),
      a.discrimination === null ? '' : String(a.discrimination),
      a.flags.join(';'),
    ]),
  ]);
}

/** A spreadsheet cell that starts with = + - @ could run as a formula when opened: prefix it. */
export function safeCell(value: string): string {
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const csvOf = (rows: readonly (readonly string[])[]): string =>
  rows.map((r) => r.map(safeCell).join(',')).join('\n') + '\n';
