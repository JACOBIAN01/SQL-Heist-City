import {
  BLOOM_LEVELS,
  DEFAULT_ANALYTICS_SETTINGS,
  RCSBE_DIMENSIONS,
  marksFor,
  type AnalyticsSettings,
  type BloomLevel,
  type RcsbeDimension,
} from './analytics';

/** What coverage needs to know about a question. */
export interface TaggedQuestion {
  readonly tier: number;
  readonly rcsbe: RcsbeDimension;
  readonly bloom: BloomLevel;
  readonly marks?: number | undefined;
}

export interface Tally {
  readonly items: number;
  readonly marks: number;
}

export interface CoverageReport {
  readonly items: number;
  readonly marks: number;
  readonly byDimension: Readonly<Record<RcsbeDimension, Tally>>;
  readonly byBloom: Readonly<Record<BloomLevel, Tally>>;
  /** Items per tier and dimension: where the paper has holes. */
  readonly byTier: Readonly<Record<number, Readonly<Record<RcsbeDimension, number>>>>;
  /** Questions per tier and Bloom level. */
  readonly byTierBloom: Readonly<Record<number, Readonly<Record<BloomLevel, number>>>>;
  /** Dimensions with no question at all. */
  readonly emptyDimensions: readonly RcsbeDimension[];
  readonly emptyBloom: readonly BloomLevel[];
}

const zero = (): Tally => ({ items: 0, marks: 0 });

/** How a set of questions spreads over the RCSBE dimensions, Bloom levels and tiers (docs/RCBSE.md §5.2). */
export function coverageOf(
  questions: readonly TaggedQuestion[],
  settings: AnalyticsSettings = DEFAULT_ANALYTICS_SETTINGS,
): CoverageReport {
  const dim = Object.fromEntries(RCSBE_DIMENSIONS.map((d) => [d, zero()])) as Record<
    RcsbeDimension,
    Tally
  >;
  const bloom = Object.fromEntries(BLOOM_LEVELS.map((b) => [b, zero()])) as Record<
    BloomLevel,
    Tally
  >;
  const tiers: Record<number, Record<RcsbeDimension, number>> = {};
  const tierBloom: Record<number, Record<BloomLevel, number>> = {};
  let items = 0;
  let marks = 0;
  for (const q of questions) {
    const m = marksFor(q, settings);
    items++;
    marks += m;
    dim[q.rcsbe] = { items: dim[q.rcsbe].items + 1, marks: dim[q.rcsbe].marks + m };
    bloom[q.bloom] = { items: bloom[q.bloom].items + 1, marks: bloom[q.bloom].marks + m };
    const row = (tiers[q.tier] ??= { R: 0, C: 0, S: 0, B: 0, E: 0 });
    row[q.rcsbe]++;
    const b = (tierBloom[q.tier] ??= Object.fromEntries(BLOOM_LEVELS.map((l) => [l, 0])) as Record<
      BloomLevel,
      number
    >);
    b[q.bloom]++;
  }
  return {
    items,
    marks,
    byDimension: dim,
    byBloom: bloom,
    byTier: tiers,
    byTierBloom: tierBloom,
    emptyDimensions: RCSBE_DIMENSIONS.filter((d) => dim[d].items === 0),
    emptyBloom: BLOOM_LEVELS.filter((b) => bloom[b].items === 0),
  };
}

export type ShapeStatus = 'missing' | 'low' | 'ok' | 'high';

export interface ShapeRow {
  readonly dimension: RcsbeDimension;
  /** Share of the set's marks, 0–100. */
  readonly actual: number;
  readonly target: number;
  readonly status: ShapeStatus;
}

/** Share of marks per dimension against the target profile; `slack` points either side of the target are fine. */
export function compareToTarget(
  report: CoverageReport,
  target: Readonly<Record<RcsbeDimension, number>>,
  slack = 10,
): ShapeRow[] {
  return RCSBE_DIMENSIONS.map((dimension) => {
    const actual =
      report.marks === 0 ? 0 : (report.byDimension[dimension].marks / report.marks) * 100;
    const t = target[dimension];
    const status: ShapeStatus =
      report.byDimension[dimension].items === 0 && t > 0
        ? 'missing'
        : actual < t - slack
          ? 'low'
          : actual > t + slack
            ? 'high'
            : 'ok';
    return { dimension, actual, target: t, status };
  });
}

/** A plain-words list of what is wrong with the shape, for the teacher. */
export function shapeProblems(
  rows: readonly ShapeRow[],
  names: Record<RcsbeDimension, string>,
): string[] {
  return rows.flatMap((r) =>
    r.status === 'ok'
      ? []
      : [
          r.status === 'missing'
            ? `${names[r.dimension]} has no questions, target ${r.target}%`
            : `${names[r.dimension]} is ${Math.round(r.actual)}% of the marks, target ${r.target}%`,
        ],
  );
}

/**
 * The tier × dimension and tier × Bloom cells with no question (Phase 17.13): each one is a
 * level of a skill no student can show at that difficulty. Empty means the set covers the grid.
 */
export function emptyCells(
  report: CoverageReport,
  tiers: readonly number[] = [1, 2, 3, 4, 5],
): string[] {
  const out: string[] = [];
  for (const t of tiers) {
    for (const d of RCSBE_DIMENSIONS) if (!report.byTier[t]?.[d]) out.push(`tier ${t} × ${d}`);
    for (const b of BLOOM_LEVELS) if (!report.byTierBloom[t]?.[b]) out.push(`tier ${t} × ${b}`);
  }
  return out;
}
