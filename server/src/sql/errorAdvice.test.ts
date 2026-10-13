import { describe, expect, it } from 'vitest';
import { SqlSandbox } from './SqlSandbox';
import { adviceFor } from './errorAdvice';
import { FeedbackBuilder } from './FeedbackBuilder';

describe('adviceFor (16.4): the common mistakes in plain words', () => {
  const cases: [string, RegExp][] = [
    ['no such column: salry', /no column "salry".*spelling/i],
    ['no such table: employes', /no table "employes"/i],
    ['ambiguous column name: id', /more than one table.*e\.id/i],
    ['near "FORM": syntax error', /confused at "FORM".*comma/i],
    ['near ",": syntax error', /confused at ",".*extra comma/i],
    ['incomplete input', /stops too soon.*bracket/i],
    ['unrecognized token: "\'abc"', /does not understand/i],
    ['misuse of aggregate: COUNT()', /HAVING/],
    ['no such function: DATEDIFF', /no function "DATEDIFF".*strftime/i],
    ['wrong number of arguments to function SUBSTR()', /"SUBSTR".*too many or too few/i],
    ['sub-select returns 2 columns - expected 1', /exactly one column/i],
    ['ORDER BY term does not match any column in the result set', /UNION/],
    ['1st ORDER BY term out of range - should be between 1 and 2', /column number/i],
    ['no tables specified', /needs a table/i],
    [
      'only a single result allowed for a SELECT that is part of an expression',
      /one row and one column/i,
    ],
    ['interrupted', /too long.*join/i],
    ['not authorized', /SELECT/],
  ];

  it.each(cases)('%s', (message, expected) => {
    expect(adviceFor(message)).toMatch(expected);
  });

  it('says nothing for an error it knows nothing about, and never reveals an answer', () => {
    expect(adviceFor('disk I/O error')).toBeUndefined();
    for (const [m] of cases) expect(adviceFor(m) ?? '').not.toMatch(/SELECT \w+ FROM \w+ WHERE/);
  });

  it('is attached to a sandbox error’s feedback, beside the raw message', () => {
    const f = new FeedbackBuilder().fromSandboxError('sql_error', 'no such column: salry');
    expect(f.message).toBe('no such column: salry');
    expect(f.advice).toMatch(/spelling/);
    expect(
      new FeedbackBuilder().fromSandboxError('sql_error', 'disk I/O error').advice,
    ).toBeUndefined();
  });

  it('matches what the real engine says for real mistakes', () => {
    const sandbox = SqlSandbox.create({
      schemaSql: 'CREATE TABLE employees (id INTEGER, name TEXT, salary INTEGER);',
      tables: new Map([
        ['employees', { columns: ['id', 'name', 'salary'], rows: [[1, 'Ana', 3000]] }],
      ]) as never,
    });
    const mistakes: [string, RegExp][] = [
      ['SELECT salry FROM employees', /no column/i],
      ['SELECT * FROM employes', /no table/i],
      ['SELECT name FORM employees', /confused at "employees"/i],
      ['SELECT name, FROM employees', /confused at "FROM"/i],
      ['SELECT name FROM employees WHERE SUM(salary) > 1', /HAVING/],
      ['SELECT NOSUCH(name) FROM employees', /no function/i],
      ['SELECT (SELECT id, name FROM employees) FROM employees', /exactly one column/i],
      ['SELECT id FROM employees e JOIN employees f ON e.id = f.id', /more than one table/i],
    ];
    for (const [sql, expected] of mistakes) {
      let message = '';
      try {
        sandbox.query(sql);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message, sql).not.toBe('');
      expect(adviceFor(message), `${sql} → ${message}`).toMatch(expected);
    }
  });
});
