import { describe, expect, it } from 'vitest';
import { CsvSyntaxError, parseCsv, toCsv } from './csv';

describe('csv', () => {
  it('round-trips quotes, commas and newlines', () => {
    const rows = [
      ['a', 'b,c', 'say "hi"'],
      ['line1\nline2', '', 'x'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('handles CRLF, LF, a BOM and a missing final newline', () => {
    expect(parseCsv('﻿a,b\r\n1,2\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('rejects broken quoting', () => {
    expect(() => parseCsv('"open')).toThrow(CsvSyntaxError);
    expect(() => parseCsv('ab"c"')).toThrow(CsvSyntaxError);
  });
});
