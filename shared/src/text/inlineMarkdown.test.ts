import { describe, expect, it } from 'vitest';
import { parseInlineMarkdown } from './inlineMarkdown';

describe('parseInlineMarkdown', () => {
  it('splits bold, code and plain text per line', () => {
    expect(parseInlineMarkdown('Find **IT** staff\nuse `WHERE`')).toEqual([
      [
        { kind: 'text', text: 'Find ' },
        { kind: 'bold', text: 'IT' },
        { kind: 'text', text: ' staff' },
      ],
      [
        { kind: 'text', text: 'use ' },
        { kind: 'code', text: 'WHERE' },
      ],
    ]);
  });

  it('leaves markup it does not know as text', () => {
    expect(parseInlineMarkdown('<img src=x> ** `')).toEqual([
      [{ kind: 'text', text: '<img src=x> ** `' }],
    ]);
  });

  it('keeps empty lines', () => {
    expect(parseInlineMarkdown('a\n\nb')).toEqual([
      [{ kind: 'text', text: 'a' }],
      [],
      [{ kind: 'text', text: 'b' }],
    ]);
  });
});
