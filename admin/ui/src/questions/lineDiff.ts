export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

/** Line diff via longest common subsequence — fine for question-sized JSON. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = lcs[i] as number[];
      row[j] =
        a[i] === b[j]
          ? (lcs[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(lcs[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] as string });
      i++;
      j++;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      out.push({ kind: 'removed', text: a[i++] as string });
    } else {
      out.push({ kind: 'added', text: b[j++] as string });
    }
  }
  while (i < a.length) out.push({ kind: 'removed', text: a[i++] as string });
  while (j < b.length) out.push({ kind: 'added', text: b[j++] as string });
  return out;
}
