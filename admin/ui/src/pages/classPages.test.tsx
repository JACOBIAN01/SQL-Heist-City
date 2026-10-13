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
