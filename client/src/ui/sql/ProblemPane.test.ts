import { beforeEach, describe, expect, it } from 'vitest';
import type { PublicChallenge } from '@heist/shared';
import { sampleChallenge } from '../../testing/FakeChallengeApi';
import { ProblemPane } from './ProblemPane';

const challenge: PublicChallenge = {
  id: 'c1',
  rewardKey: 'heal:small',
  tier: 1,
  title: 'Payroll Leak',
  story: 'List employees in **Audit** earning over `5000`.\nSecond line <b>not bold</b>',
  schemaSql: 'CREATE TABLE employees (id INTEGER, name TEXT);',
  tables: [
    {
      name: 'employees',
      columns: ['id', 'name', 'boss'],
      sampleRows: [
        [1, 'Ana', null],
        [2, 'Ben', 7],
      ],
      rowCount: 40,
    },
  ],
  example: {
    tables: [
      {
        name: 'employees',
        columns: ['id', 'name', 'boss'],
        sampleRows: [
          [1, 'Zoe', null],
          [2, 'Yan', 1],
        ],
        rowCount: 2,
      },
    ],
    output: { columns: ['name'], rows: [['Yan']], rowCount: 12 },
  },
  columnsMatter: false,
  orderMatters: false,
  hintCosts: [0.05, 0.1],
  hintCostMode: 'fraction',
  expiresAt: 0,
};

let host: HTMLElement;
let pane: ProblemPane;
beforeEach(() => {
  host = document.createElement('div');
  pane = new ProblemPane(host);
});

describe('ProblemPane', () => {
  it('renders story formatting from text, never as HTML', () => {
    pane.show(challenge);
    expect(host.querySelector('.sqlp-story strong')?.textContent).toBe('Audit');
    expect(host.querySelector('.sqlp-story code')?.textContent).toBe('5000');
    expect(host.querySelector('.sqlp-story b')).toBeNull();
    expect(host.querySelector('.sqlp-story')?.textContent).toContain('<b>not bold</b>');
  });

  it('shows each table with columns, sample rows, NULLs and the hidden row count', () => {
    pane.show(challenge);
    const card = host.querySelector('.sqlp-card') as HTMLElement;
    const headers = [...card.querySelectorAll('th')].map((t) => t.textContent);
    expect(headers).toEqual(['id', 'name', 'boss']);
    const rows = [...card.querySelectorAll('tbody tr')].map((r) =>
      [...r.querySelectorAll('td')].map((c) => c.textContent),
    );
    expect(rows).toEqual([
      ['1', 'Ana', 'NULL'],
      ['2', 'Ben', '7'],
    ]);
    expect(host.querySelector('.sqlp-card')?.textContent).toContain('40 rows');
    expect(host.textContent).toContain('…and 38 more rows');
  });

  it('shows the expected output: the columns, the rules, and a worked example', () => {
    pane.show(challenge);
    const shape = host.querySelector('.sqlp-output-shape') as HTMLElement;
    expect([...shape.querySelectorAll('th')].map((t) => t.textContent)).toEqual(['name']);
    expect(host.querySelector('.sqlp-rules')?.textContent).toBe(
      "Return these columns in this order; their names don't have to match. Rows can come in any order.",
    );
    const example = host.querySelector('.sqlp-example') as HTMLDetailsElement;
    expect(example.open).toBe(true);
    expect(example.textContent).toContain('Zoe');
    const cards = example.querySelectorAll('.sqlp-card');
    expect(cards[cards.length - 1]?.textContent).toContain('Yan');
    expect(example.textContent).toContain('…and 11 more rows');
  });

  it('says when names and order matter', () => {
    pane.show({ ...challenge, columnsMatter: true, orderMatters: true });
    expect(host.querySelector('.sqlp-rules')?.textContent).toBe(
      'Use exactly these column names, in this order. Rows must come in this order.',
    );
  });

  it('leaves the section out when there is no example', () => {
    const { example: _example, ...without } = challenge;
    pane.show(without);
    expect(host.querySelector('.sqlp-example')).toBeNull();
    expect(host.textContent).not.toContain('Expected output');
  });

  it('gives the tutorial solution away on request and hands it to the editor', () => {
    const used: string[] = [];
    pane = new ProblemPane(host, (sql) => used.push(sql));
    pane.show({ ...challenge, solution: 'SELECT name FROM employees;' });
    const sql = host.querySelector('.sqlp-solution-sql') as HTMLElement;
    expect(sql.hidden).toBe(true);
    (host.querySelector('.sqlp-solution-btn') as HTMLButtonElement).click();
    expect(sql.hidden).toBe(false);
    expect(sql.textContent).toBe('SELECT name FROM employees;');
    expect(used).toEqual(['SELECT name FROM employees;']);
  });

  it('shows no solution outside the tutorial', () => {
    pane.show(challenge);
    expect(host.querySelector('.sqlp-solution')).toBeNull();
  });

  it('offers the CREATE TABLE text on demand', () => {
    pane.show(challenge);
    expect(host.querySelector('.sqlp-schema pre')?.textContent).toBe(challenge.schemaSql);
  });

  it('replaces earlier content and can show a plain message', () => {
    pane.show(challenge);
    pane.showMessage('Loading…');
    expect(host.textContent).toBe('Loading…');
  });

  it('lists revealed hints with their cost, and clears them for a new task', () => {
    pane.show(challenge);
    pane.showHints([
      { index: 0, text: 'Use `WHERE`', cost: 0.05, costMode: 'fraction', charged: true },
      { index: 1, text: 'Compare salary', cost: 250, costMode: 'absolute', charged: true },
    ]);
    const hints = [...host.querySelectorAll('.sqlp-hint')].map((h) => h.textContent);
    expect(hints).toEqual(['Hint 1 · −5% of your cashUse `WHERE`', 'Hint 2 · −$250Compare salary']);
    pane.show(challenge);
    expect(host.querySelectorAll('.sqlp-hint')).toHaveLength(0);
  });
});

describe('ProblemPane: dialect notes (17.14)', () => {
  it("shows the class's dialect notes, this question's first and open, the rest as a cheat-sheet", () => {
    const host = document.createElement('div');
    new ProblemPane(host).show(
      sampleChallenge({
        dialect: {
          name: 'PostgreSQL',
          intro: 'The game runs SQLite.',
          entries: [
            {
              quirk: 'like-case',
              note: 'LIKE cares about case.',
              sqlite: 'LIKE',
              dialect: 'ILIKE',
              here: true,
            },
            {
              quirk: 'dates',
              note: 'Dates differ.',
              sqlite: 'strftime',
              dialect: 'EXTRACT',
              here: false,
            },
          ],
        },
      }),
    );
    const notes = host.querySelector('.sqlp-dialect') as HTMLDetailsElement;
    expect(notes.open).toBe(true);
    expect(notes.querySelector('summary')?.textContent).toBe(
      'PostgreSQL notes (1 for this question)',
    );
    expect(notes.textContent).toContain('ILIKE');
    expect((host.querySelector('.sqlp-dialect-sheet') as HTMLElement).textContent).toContain(
      'EXTRACT',
    );
  });

  it('shows nothing for a class on SQLite', () => {
    const host = document.createElement('div');
    new ProblemPane(host).show(sampleChallenge());
    expect(host.querySelector('.sqlp-dialect')).toBeNull();
  });
});
