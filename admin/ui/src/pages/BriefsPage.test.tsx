import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BriefView } from '@heist/shared';
import { fakeApi, renderWithProviders, teacher } from '../testing/render';
import { BriefsPage } from './BriefsPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const brief = (id: string, name: string): BriefView => ({
  id,
  playerId: 1,
  playerName: name,
  classId: 7,
  round: 2,
  questionId: 9,
  questionVersion: 1,
  title: 'Plan the heist',
  story: 'Plan **it**.',
  rcsbe: 'B',
  bloom: 'create',
  itemMarks: 6,
  topics: [],
  rubric: [
    { criterion: 'Sets a goal', marks: 2 },
    { criterion: 'Checks it worked', marks: 4 },
  ],
  text: `${name}'s goal: the richest branch.`,
  sql: 'SELECT branch FROM accounts',
  submittedAt: 0,
  marks: null,
  feedback: null,
  markedBy: null,
  markedAt: null,
});

describe('BriefsPage', () => {
  it('shows the first brief, marks each criterion, and moves on to the next', async () => {
    let queue = [brief('b1', 'Ana'), brief('b2', 'Ben')];
    const calls = fakeApi({
      'GET /auth/me': () => ({ body: { user: teacher } }),
      'GET /briefs': () => ({ body: { briefs: queue } }),
      'POST /briefs/b1/mark': () => {
        queue = queue.slice(1);
        return { body: { brief: { ...brief('b1', 'Ana'), marks: [2, 3] } } };
      },
    });
    renderWithProviders(<BriefsPage />);
    const user = userEvent.setup();
    expect(await screen.findByText("Ana's goal: the richest branch.")).toBeTruthy();
    const goal = screen.getByLabelText('Sets a goal (out of 2)');
    await user.clear(goal);
    await user.type(goal, '2');
    const check = screen.getByLabelText('Checks it worked (out of 4)');
    await user.clear(check);
    await user.type(check, '3');
    expect(screen.getByText('Total: 5 / 6')).toBeTruthy();
    await user.type(screen.getByLabelText('Feedback for the student (optional)'), 'Nice.');
    await user.click(screen.getByRole('button', { name: 'Save and next' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        marks: [2, 3],
        feedback: 'Nice.',
      }),
    );
    expect(await screen.findByText("Ben's goal: the richest branch.")).toBeTruthy();
  });
});
