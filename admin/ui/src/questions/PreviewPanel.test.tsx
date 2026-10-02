import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PreviewReport } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { fakeApi, renderWithProviders } from '../testing/render';
import { PreviewPanel } from './PreviewPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const report: PreviewReport = {
  ok: false,
  differentAnswerRate: 0.5,
  seeds: [
    {
      seed: 'preview-1',
      story: 'List employees in Audit',
      referenceSql: "SELECT name FROM employees WHERE dept = 'Audit'",
      expected: { columns: ['name'], rows: [['Ana'], ['Ben']] },
      tables: [{ name: 'employees', columns: ['name'], rows: [['Ana'], ['Ben'], ['Cy']] }],
      runtimeMs: 3,
      issues: [],
      student: {
        status: 'wrong',
        feedback: { code: 'row_count', message: 'Your query returns 3 rows; the answer has 2.' },
      },
    },
    { seed: 'preview-2', runtimeMs: 1, issues: ['error'], error: 'no such column: nope' },
  ],
};

describe('PreviewPanel', () => {
  it('posts the draft and renders each seed', async () => {
    const calls = fakeApi({ 'POST /questions/preview': () => ({ body: { report } }) });
    renderWithProviders(<PreviewPanel template={sampleQuestion} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Run preview' }));

    expect(await screen.findByText('Problems found')).toBeTruthy();
    expect(screen.getByText(/50% of player pairs share an answer/)).toBeTruthy();
    expect(screen.getByText('List employees in Audit')).toBeTruthy();
    expect(screen.getByText('Expected answer (2 rows)')).toBeTruthy();
    expect(screen.getByText('student: wrong')).toBeTruthy();
    expect(screen.getByText('no such column: nope')).toBeTruthy();

    const body = calls[0]?.body as { template: { slug: string }; seeds: string[] };
    expect(body.template.slug).toBe(sampleQuestion.slug);
    expect(body.seeds).toEqual(['preview-1', 'preview-2', 'preview-3']);
  });
});
