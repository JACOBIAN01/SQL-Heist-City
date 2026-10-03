import { beforeEach, describe, expect, it } from 'vitest';
import type { PublicChallenge } from '@heist/shared';
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
  hintCount: 2,
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
    const headers = [...host.querySelectorAll('th')].map((t) => t.textContent);
    expect(headers).toEqual(['id', 'name', 'boss']);
    const rows = [...host.querySelectorAll('tbody tr')].map((r) =>
      [...r.querySelectorAll('td')].map((c) => c.textContent),
    );
    expect(rows).toEqual([
      ['1', 'Ana', 'NULL'],
      ['2', 'Ben', '7'],
    ]);
    expect(host.querySelector('.sqlp-card')?.textContent).toContain('40 rows');
    expect(host.textContent).toContain('…and 38 more rows');
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
});
