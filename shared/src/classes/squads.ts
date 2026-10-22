/** A student as the balancer sees them: their overall mastery score (0–100), or null when unknown. */
export interface BalanceStudent {
  readonly id: number;
  readonly score: number | null;
}

/**
 * Splits students into squads of balanced strength (Phase 27.2). Strongest first, dealt out in a
 * snake (1, 2, 3, 3, 2, 1, 1, 2, 3 …) so every squad gets a mix and none is stacked. Students whose
 * score is unknown count as average, so a newcomer is neither a star nor a liability. The number
 * of squads is the fewest that keeps every squad at or under `size`, and squads differ in size by
 * at most one student.
 */
export function balanceSquads(
  students: readonly BalanceStudent[],
  size: number,
  maxSquads: number,
): Record<number, number> {
  if (students.length === 0) return {};
  const known = students.flatMap((s) => (s.score === null ? [] : [s.score]));
  const average = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 50;
  const squads = Math.min(maxSquads, Math.max(1, Math.ceil(students.length / size)));
  const ordered = [...students].sort(
    (a, b) => (b.score ?? average) - (a.score ?? average) || a.id - b.id,
  );
  const out: Record<number, number> = {};
  ordered.forEach((student, i) => {
    const round = Math.floor(i / squads);
    const pos = i % squads;
    out[student.id] = (round % 2 === 0 ? pos : squads - 1 - pos) + 1;
  });
  return out;
}

/** The size of each squad in an assignment, by squad number. */
export function squadSizes(assignments: Readonly<Record<number, number>>): Map<number, number> {
  const sizes = new Map<number, number>();
  for (const squad of Object.values(assignments)) sizes.set(squad, (sizes.get(squad) ?? 0) + 1);
  return sizes;
}

/** Problems with a teacher's list: a squad over the size, or a squad number outside 1…max. */
export function assignmentProblems(
  assignments: Readonly<Record<number, number>>,
  size: number,
  maxSquads: number,
): string[] {
  const problems: string[] = [];
  for (const [squad, n] of squadSizes(assignments))
    if (!Number.isInteger(squad) || squad < 1 || squad > maxSquads)
      problems.push(`squad ${squad} is not one of the ${maxSquads} squads`);
    else if (n > size) problems.push(`squad ${squad} has ${n} students; the most is ${size}`);
  return problems;
}
