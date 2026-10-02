import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImportReport } from '@heist/shared';
import { fakeApi, renderWithProviders } from '../testing/render';
import { ImportExportPage } from './ImportExportPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const report: ImportReport = {
  dryRun: true,
  counts: { created: 1, updated: 0, skipped: 0, invalid: 1 },
  items: [
    { index: 1, slug: 'one', status: 'created' },
    { index: 2, slug: 'two', status: 'invalid', errors: ['tier: Too big'] },
  ],
};

describe('ImportExportPage', () => {
  it('dry-runs pasted JSON and shows per-row results', async () => {
    const calls = fakeApi({ 'POST /questions/import': () => ({ body: { report } }) });
    renderWithProviders(<ImportExportPage />);
    const user = userEvent.setup();
    await user.click(screen.getByPlaceholderText(/questions/));
    await user.paste('{"questions": []}');
    await user.click(screen.getByRole('button', { name: 'Check import' }));
    expect(await screen.findByText('Dry-run result (nothing saved)')).toBeTruthy();
    expect(screen.getByText('tier: Too big')).toBeTruthy();
    expect(screen.getByText('would be created: 1')).toBeTruthy();
    expect(calls[0]?.body).toEqual({ questions: [] });
  });

  it('detects CSV text', async () => {
    fakeApi({});
    renderWithProviders(<ImportExportPage />);
    const user = userEvent.setup();
    await user.click(screen.getByPlaceholderText(/questions/));
    await user.paste('slug,title,tier\n');
    expect(screen.getByText('Detected: CSV')).toBeTruthy();
  });

  it('links to both export formats', () => {
    fakeApi({});
    renderWithProviders(<ImportExportPage />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/api/questions/export?format=json',
      '/api/questions/export?format=csv',
    ]);
  });
});
