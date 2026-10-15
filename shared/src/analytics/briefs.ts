import { z } from 'zod';
import type { BloomLevel, RcsbeDimension } from '../questions/analytics';

/** One handed-in open brief, as the teacher's marking queue shows it (Phase 17.11). */
export interface BriefView {
  /** The challenge it answered (unique). */
  readonly id: string;
  readonly playerId: number | null;
  readonly playerName?: string;
  readonly classId: number | null;
  readonly round: number | null;
  readonly questionId: number;
  readonly questionVersion: number;
  readonly title: string;
  readonly story: string;
  readonly rcsbe: RcsbeDimension;
  readonly bloom: BloomLevel;
  /** The question's weight in the profile: what a full-marks brief earns. */
  readonly itemMarks: number;
  readonly topics: readonly string[];
  readonly rubric: readonly { readonly criterion: string; readonly marks: number }[];
  readonly text: string;
  readonly sql: string;
  readonly submittedAt: number;
  /** Marks per rubric criterion, once marked. */
  readonly marks: readonly number[] | null;
  readonly feedback: string | null;
  readonly markedBy: string | null;
  readonly markedAt: number | null;
}

export const briefMarkSchema = z.object({
  /** One whole number per rubric criterion, from 0 to that criterion's marks. */
  marks: z.array(z.number().int().min(0).max(20)).min(1).max(10),
  feedback: z.string().trim().max(2000).optional(),
});
export type BriefMark = z.infer<typeof briefMarkSchema>;

/** Why marks do not fit a rubric, or null when they do. */
export function briefMarkProblem(
  rubric: BriefView['rubric'],
  marks: readonly number[],
): string | null {
  if (marks.length !== rubric.length)
    return `expected ${rubric.length} marks (one per criterion), got ${marks.length}`;
  const over = rubric.findIndex((r, i) => (marks[i] ?? 0) > r.marks);
  return over === -1 ? null : `"${rubric[over]?.criterion}" is out of ${rubric[over]?.marks}`;
}

/** What a marked brief earns in the profile: its weight times the share of the rubric's marks. */
export function briefEarned(
  itemMarks: number,
  rubric: BriefView['rubric'],
  marks: readonly number[],
): number {
  const total = rubric.reduce((s, r) => s + r.marks, 0);
  const got = marks.reduce((s, m) => s + m, 0);
  return total === 0 ? 0 : Math.round(((itemMarks * got) / total) * 100) / 100;
}
