import { describe, expect, it } from 'vitest';
import { changes, labelOf, leaves, withLeaf } from './sectionFields';

const tree = { a: 1, kinds: { sedan: { maxSpeed: 20, accel: 7 } }, seed: 'x', list: [1] };

describe('settings tree helpers', () => {
  it('lists numbers and text with their paths, skipping arrays', () => {
    expect(leaves(tree).map((l) => l.path.join('.'))).toEqual([
      'a',
      'kinds.sedan.maxSpeed',
      'kinds.sedan.accel',
      'seed',
    ]);
  });

  it('replaces one leaf without touching the original', () => {
    const next = withLeaf(tree, ['kinds', 'sedan', 'maxSpeed'], 31);
    expect(next.kinds).toEqual({ sedan: { maxSpeed: 31, accel: 7 } });
    expect(tree.kinds.sedan.maxSpeed).toBe(20);
  });

  it('keeps only what changed, nested', () => {
    const edited = withLeaf(withLeaf(tree, ['a'], 2), ['kinds', 'sedan', 'accel'], 9);
    expect(changes(edited, tree)).toEqual({ a: 2, kinds: { sedan: { accel: 9 } } });
    expect(changes(tree, tree)).toEqual({});
  });

  it('turns paths into readable labels', () => {
    expect(labelOf(['kinds', 'sedan', 'maxSpeed'])).toBe('sedan · max speed');
    expect(labelOf(['vaultLootByTier', '3'])).toBe('vault loot by tier · 3');
  });
});
