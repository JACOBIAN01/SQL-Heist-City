import { describe, expect, it } from 'vitest';
import { lineDiff } from './lineDiff';

describe('lineDiff', () => {
  it('marks added, removed and unchanged lines', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'x' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
  });

  it('identical texts have no changes', () => {
    expect(lineDiff('x\ny', 'x\ny').every((l) => l.kind === 'same')).toBe(true);
  });
});
