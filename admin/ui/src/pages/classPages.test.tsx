import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import type { ClassRecord } from '@heist/shared';
import { admin, fakeApi, renderWithProviders, teacher } from '../testing/render';
import { ClassEditorPage } from './ClassEditorPage';
import { ClassesPage } from './ClassesPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const record: ClassRecord = {
  id: 7,
  code: 'K7M2QX',
  name: '9B SQL',
  ownerUserId: 1,
  citySeed: null,
  banksOpen: [1, 2, 3, 4, 5],
  roundMinutes: null,
  playerCap: 100,
  locked: false,
  archived: false,
  createdAt: '',
  updatedAt: '',
};
const question = (id: number, tier: number, slug: string) => ({
  id,
  slug,
  title: `Question ${slug}`,
  tier,
  topics: [],
  enabled: true,
  version: 1,
  updatedAt: '',
});

function api(user: typeof teacher | typeof admin = teacher) {
  return fakeApi({
    'GET /auth/me': () => ({ body: { user } }),
    'GET /classes': () => ({ body: { classes: [record] } }),
    'POST /classes': (b) => ({ status: 201, body: { class: { ...record, ...(b as object) } } }),
    'DELETE /classes/7': () => ({ status: 204 }),
    'GET /classes/7': () => ({ body: { class: record } }),
    'PUT /classes/7': (b) => ({ body: { class: { ...record, ...(b as object) } } }),
    'POST /classes/7/code': () => ({ body: { class: { ...record, code: 'NEW123' } } }),
    'GET /classes/7/questions': () => ({
      body: { links: [{ questionId: 1, usage: 'heal', slug: 'a', title: 'Question a', tier: 1 }] },
    }),
    'PUT /classes/7/questions': (b) => ({ body: b }),
    'GET /classes/7/live': () => ({ body: { status: { state: 'waiting' }, connected: true } }),
    'POST /classes/7/live/start': () => ({
      body: { status: { state: 'live', players: 0, maxPlayers: 100 } },
    }),
    'POST /classes/7/live/kick': () => ({ body: { status: { state: 'live' } } }),
    'POST /classes/7/lock': () => ({ body: { class: { ...record, locked: true } } }),
    'GET /classes/7/results': () => ({
      body: {
        rounds: [
          {
            id: 3,
            number: 2,
            startedAt: '',
            endedAt: '2026-03-01T10:15:00Z',
            players: 2,
            winner: { name: 'Ana', banked: 9000 },
          },
        ],
      },
    }),
    'GET /classes/7/results/3': () => ({
      body: {
        round: {
          id: 3,
          number: 2,
          startedAt: '',
          endedAt: '',
          players: 2,
          winner: null,
          awards: [],
        },
        standings: [
          { rank: 1, name: 'Ana', banked: 9000, kills: 4, deaths: 1 },
          { rank: 2, name: 'Ben', banked: 3000, kills: 1, deaths: 2 },
        ],
      },
    }),
    'GET /classes/7/assessments': () => ({ body: { pre: null, post: null } }),
    'PUT /classes/7/assessments/pre': (b) => ({
      body: { assessment: { id: 1, classId: 7, kind: 'pre', ...(b as object) } },
    }),
    'GET /classes/7/roster': () => ({
      body: {
        roster: [
          {
            playerId: 3,
            joinedAt: '2026-01-01T10:00:00Z',
            displayName: 'Ana',
            email: 'ana@school.edu',
          },
        ],
      },
    }),
    'GET /questions': () => ({ body: { questions: [question(1, 1, 'a'), question(2, 3, 'b')] } }),
  });
}

describe('ClassesPage', () => {
  it('lists classes with their join codes and creates a new one', async () => {
    const calls = api();
    renderWithProviders(<ClassesPage />);
    const user = userEvent.setup();
    expect(await screen.findByText('K7M2QX')).toBeTruthy();
    expect(screen.getByRole('link', { name: '9B SQL' }).getAttribute('href')).toBe('/classes/7');
    await user.type(screen.getByLabelText('New class name'), '  10A  ');
    await user.click(screen.getByRole('button', { name: 'Create class' }));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/classes');
    expect(post?.body).toEqual({ name: '10A' });
  });
});

function renderEditor() {
  return renderWithProviders(
    <Routes>
      <Route path="/classes/:id" element={<ClassEditorPage />} />
    </Routes>,
    '/classes/7',
  );
}

describe('ClassEditorPage', () => {
  it('closes a bank and saves the settings', async () => {
    const calls = api();
    renderEditor();
    const user = userEvent.setup();
    expect(await screen.findByText('K7M2QX')).toBeTruthy();
    await user.click(screen.getByLabelText('Bank 4'));
    await user.type(screen.getByLabelText(/Round length/), '8');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await screen.findByText('Saved ✓');
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/classes/7');
    expect(put?.body).toMatchObject({
      banksOpen: [1, 2, 3, 5],
      roundMinutes: 8,
      playerCap: 100,
      citySeed: null,
    });
  });

  it('shows the released questions ticked, and saves a changed set', async () => {
    const calls = api();
    renderEditor();
    const user = userEvent.setup();
    const healA = (await screen.findByLabelText('a heal')) as HTMLInputElement;
    expect(healA.checked).toBe(true);
    await user.click(screen.getByLabelText('b vault'));
    await user.click(screen.getByLabelText('a heal'));
    await user.click(screen.getByRole('button', { name: 'Save question set' }));
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/classes/7/questions');
    expect(put?.body).toEqual({ links: [{ questionId: 2, usage: 'vault' }] });
  });

  it('filters the question list', async () => {
    api();
    renderEditor();
    const user = userEvent.setup();
    await screen.findByLabelText('a heal');
    await user.type(screen.getByLabelText('Filter questions'), 'b');
    expect(screen.queryByLabelText('a heal')).toBeNull();
    expect(screen.getByLabelText('b heal')).toBeTruthy();
  });

  it('starts the match on the teacher’s word, and can lock the room', async () => {
    const calls = api();
    renderEditor();
    const user = userEvent.setup();
    expect(await screen.findByText('NOT STARTED')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Start the match' }));
    await user.click(screen.getByRole('button', { name: 'Lock the room to new students' }));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/classes/7/live/start')).toBe(true);
    expect(calls.find((c) => c.path === '/classes/7/lock')?.body).toEqual({ locked: true });
  });

  it('removes a student from the room after confirming', async () => {
    const calls = api();
    vi.stubGlobal('confirm', () => true);
    renderEditor();
    const user = userEvent.setup();
    await screen.findByText('Ana');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(calls.find((c) => c.path === '/classes/7/live/kick')?.body).toEqual({ playerId: 3 });
  });

  it('lists finished rounds and opens one to show its table', async () => {
    api();
    renderEditor();
    const user = userEvent.setup();
    expect(await screen.findByText(/Won by Ana/)).toBeTruthy();
    await user.click(screen.getByText('Round 2'));
    const table = await screen.findByRole('table', { name: 'Round results' });
    expect(within(table).getByText('Ben')).toBeTruthy();
    expect(within(table).getByText('$9,000')).toBeTruthy();
  });

  it("sets up a pre-test from the class's questions and opens it", async () => {
    const calls = api();
    renderEditor();
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('pre a'));
    await user.click(screen.getByLabelText('pre open'));
    await user.click(screen.getByRole('button', { name: 'Save pre-test' }));
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/classes/7/assessments/pre');
    expect(put?.body).toEqual({ questionIds: [1], open: true });
  });

  it('shows who joined, without emails for a teacher', async () => {
    api(teacher);
    renderEditor();
    const row = (await screen.findByText('Ana')).closest('tr') as HTMLElement;
    expect(within(row).queryByText('ana@school.edu')).toBeNull();
  });

  it('shows emails to an admin', async () => {
    api(admin);
    renderEditor();
    const row = (await screen.findByText('Ana')).closest('tr') as HTMLElement;
    expect(await within(row).findByText('ana@school.edu')).toBeTruthy();
  });
});
