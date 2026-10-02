import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { sampleQuestion } from '@heist/shared/fixtures';
import { fakeApi, renderWithProviders } from '../testing/render';
import { VersionsPanel } from './VersionsPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const versions = [
  {
    version: 1,
    createdBy: 'a@school.test',
    createdAt: '2026-01-01T00:00:00Z',
    template: sampleQuestion,
  },
  {
    version: 2,
    createdBy: 'b@school.test',
    createdAt: '2026-01-02T00:00:00Z',
    template: { ...sampleQuestion, title: 'Renamed' },
  },
];

describe('VersionsPanel', () => {
  it('shows the latest change as a diff and restores an old version', async () => {
    vi.stubGlobal('confirm', () => true);
    const calls = fakeApi({
      'GET /questions/3/versions': () => ({ body: { versions } }),
      'POST /questions/3/rollback/1': () => ({ body: { question: {} } }),
      'GET /questions/3': () => ({ body: { question: {} } }),
    });
    const { container } = renderWithProviders(<VersionsPanel id={3} />);
    await screen.findByText(/Changes in v2/);
    const lines = (kind: string) =>
      [...container.querySelectorAll(`.diff .${kind}`)].map((e) => e.textContent);
    expect(lines('added')).toEqual(['+   "title": "Renamed",']);
    expect(lines('removed')).toEqual([`-   "title": "${sampleQuestion.title}",`]);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Restore' }));
    await vi.waitFor(() =>
      expect(calls.some((c) => c.path === '/questions/3/rollback/1')).toBe(true),
    );
  });
});
