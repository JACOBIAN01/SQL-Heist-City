import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeApi, renderWithProviders } from '../testing/render';
import { CustomHeistsPage, parseStory } from './CustomHeistsPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const heist = {
  id: 3,
  name: 'Library job',
  shareCode: 'ABCD2345',
  mode: 'custom-3',
  spec: {
    name: 'Library job',
    story: { title: 'The library', lines: [{ speaker: 'Mae', text: 'Quietly now.' }] },
    bank: 2,
    locks: ['select-all', 'where-basics'],
    roundMinutes: 15,
  },
};

describe('parseStory', () => {
  it('reads "Name: text" rows, and gives a row with no name to the crew', () => {
    expect(parseStory('Mae: Quietly now.\n\nJust a line\n')).toEqual([
      { speaker: 'Mae', text: 'Quietly now.' },
      { speaker: 'Crew', text: 'Just a line' },
    ]);
  });
});

describe('CustomHeistsPage', () => {
  it('lists a teacher’s heists with their share codes and the mode a class takes', async () => {
    fakeApi({ 'GET /custom-heists': () => ({ body: { heists: [heist] } }) });
    renderWithProviders(<CustomHeistsPage />);
    expect(await screen.findByText('Library job')).toBeTruthy();
    expect(screen.getByText('ABCD2345')).toBeTruthy();
    expect(screen.getByText('custom-3')).toBeTruthy();
  });

  it('builds a heist from a story and a list of question slugs', async () => {
    const calls = fakeApi({
      'GET /custom-heists': () => ({ body: { heists: [] } }),
      'POST /custom-heists': () => ({ status: 201, body: { heist } }),
    });
    renderWithProviders(<CustomHeistsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New heist' }));
    await user.type(screen.getByLabelText('Name'), 'Library job');
    await user.type(screen.getByLabelText(/Questions, one slug/), 'select-all{enter}where-basics');
    await user.click(screen.getByRole('button', { name: 'Save heist' }));
    await vi.waitFor(() => {
      const post = calls.find((c) => c.method === 'POST');
      expect(post?.body).toMatchObject({
        name: 'Library job',
        bank: 1,
        locks: ['select-all', 'where-basics'],
        story: { title: 'The job', lines: [{ speaker: 'Crew', text: 'Here is the plan.' }] },
      });
    });
  });

  it('copies another teacher’s heist by its share code', async () => {
    const calls = fakeApi({
      'GET /custom-heists': () => ({ body: { heists: [] } }),
      'POST /custom-heists/import': () => ({ status: 201, body: { heist } }),
    });
    renderWithProviders(<CustomHeistsPage />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Copy a heist by share code'), 'abcd2345');
    await user.click(screen.getByRole('button', { name: 'Copy it' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.path === '/custom-heists/import')?.body).toEqual({
        code: 'abcd2345',
      }),
    );
  });
});
