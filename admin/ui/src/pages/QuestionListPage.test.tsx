import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QuestionSummary } from '@heist/shared';
import { fakeApi, renderWithProviders } from '../testing/render';
import { QuestionListPage } from './QuestionListPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const summary = (over: Partial<QuestionSummary>): QuestionSummary => ({
  id: 1,
  slug: 'payroll-leak',
  title: 'Payroll Leak',
  tier: 1,
  topics: ['select', 'where'],
  enabled: true,
  version: 3,
  updatedAt: '',
  ...over,
});

describe('QuestionListPage', () => {
  it('lists questions and sends filters to the API', async () => {
    const calls = fakeApi({
      'GET /questions': (_b, url) => ({
        body: {
          questions:
            url.searchParams.get('tier') === '3'
              ? [summary({ id: 2, slug: 'join-it', title: 'Join It', tier: 3 })]
              : [
                  summary({}),
                  summary({ id: 2, slug: 'join-it', title: 'Join It', tier: 3, enabled: false }),
                ],
        },
      }),
    });
    renderWithProviders(<QuestionListPage />);
    expect(await screen.findByText('Payroll Leak')).toBeTruthy();
    expect(screen.getByText('disabled')).toBeTruthy();

    await userEvent.setup().selectOptions(screen.getByLabelText('Tier filter'), '3');
    await screen.findByText('Join It');
    expect(screen.queryByText('Payroll Leak')).toBeNull();
    expect(calls.some((c) => c.path === '/questions')).toBe(true);
  });

  it('disables a question from the list', async () => {
    let enabled = true;
    const calls = fakeApi({
      'GET /questions': () => ({ body: { questions: [summary({ enabled })] } }),
      'POST /questions/1/disable': () => {
        enabled = false;
        return { body: { question: { ...summary({ enabled: false }), template: {} } } };
      },
    });
    renderWithProviders(<QuestionListPage />);
    const row = (await screen.findByText('Payroll Leak')).closest('tr') as HTMLElement;
    await userEvent.setup().click(within(row).getByRole('button', { name: 'Disable' }));
    expect(await within(row).findByText('disabled')).toBeTruthy();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain('POST /questions/1/disable');
  });

  it('shows an empty state', async () => {
    fakeApi({ 'GET /questions': () => ({ body: { questions: [] } }) });
    renderWithProviders(<QuestionListPage />);
    expect(await screen.findByText(/No questions match/)).toBeTruthy();
  });
});
