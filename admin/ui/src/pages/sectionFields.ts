/** A number or text in a settings tree, with where it sits (`kinds.sedan.maxSpeed`). */
export interface Leaf {
  readonly path: readonly string[];
  readonly value: number | string;
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every number and string in the tree, in order. */
export function leaves(tree: Record<string, unknown>, prefix: readonly string[] = []): Leaf[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    if (typeof value === 'number' || typeof value === 'string')
      return [{ path: [...prefix, key], value }];
    return isPlain(value) ? leaves(value, [...prefix, key]) : [];
  });
}

export const read = (tree: Record<string, unknown>, path: readonly string[]): unknown =>
  path.reduce<unknown>((node, key) => (isPlain(node) ? node[key] : undefined), tree);

/** A copy of the tree with one leaf replaced. */
export function withLeaf(
  tree: Record<string, unknown>,
  path: readonly string[],
  value: number | string,
): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined) return tree;
  const child = tree[head];
  return {
    ...tree,
    [head]: rest.length === 0 ? value : withLeaf(isPlain(child) ? child : {}, rest, value),
  };
}

/** Only the leaves of `edited` that differ from `original`, as a nested change. */
export function changes(
  edited: Record<string, unknown>,
  original: Record<string, unknown>,
): Record<string, unknown> {
  let out: Record<string, unknown> = {};
  for (const leaf of leaves(edited)) {
    if (read(original, leaf.path) !== leaf.value) out = withLeaf(out, leaf.path, leaf.value);
  }
  return out;
}

/** `kinds.sedan.maxSpeed` → "sedan · max speed". */
export function labelOf(path: readonly string[]): string {
  const words = (s: string) => s.replace(/([A-Z])/g, ' $1').toLowerCase();
  const last = path[path.length - 1] ?? '';
  const group = path.slice(0, -1).filter((p) => p !== 'kinds');
  return [...group.map(words), words(last)].join(' · ');
}
