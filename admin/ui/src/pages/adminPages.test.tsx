import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { admin, fakeApi, renderWithProviders } from '../testing/render';
import { AuditPage } from './AuditPage';
import { PoolsPage } from './PoolsPage';
import { UsersPage } from './UsersPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const q = (id: number, title: string) => ({
  id,
  slug: `q-${id}`,
  title,
  tier: 1,
  topics: [],
  enabled: true,
  version: 1,
  updatedAt: '',
});

describe('PoolsPage', () => {
  it('creates a pool from selected questions', async () => {
    const calls = fakeApi({
      'GET /pools': () => ({ body: { pools: [] } }),
      'GET /questions': () => ({ body: { questions: [q(1, 'First'), q(2, 'Second')] } }),
      'POST /pools': (b) => ({ status: 201, body: { pool: { id: 1, ...(b as object) } } }),
    });
    renderWithProviders(<PoolsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New pool' }));
    await user.type(screen.getByLabelText('Name'), 'Week 3');
    await user.click(await screen.findByLabelText(/Second/));
    await user.click(screen.getByRole('button', { name: 'Save pool' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        name: 'Week 3',
        description: '',
        questionIds: [2],
      }),
    );
  });
});

describe('AuditPage', () => {
  it('lists entries and filters by entity', async () => {
    const calls = fakeApi({
      'GET /audit': (_b, url) => ({
        body: {
          entries: [
            {
              id: 5,
              actor: 'a@school.test',
              action: 'update',
              entity: url.searchParams.get('entity') ?? 'question',
              entityId: '3',
              detail: { changed: ['title'] },
              at: '2026-01-01T00:00:00Z',
            },
          ],
        },
      }),
    });
    renderWithProviders(<AuditPage />);
    expect(await screen.findByText('a@school.test')).toBeTruthy();
    await userEvent.setup().selectOptions(screen.getByLabelText('Show'), 'user');
    await vi.waitFor(() => expect(calls.at(-1)?.path).toBe('/audit'));
    expect(await screen.findByText(/update user/)).toBeTruthy();
  });
});

describe('UsersPage', () => {
  it('adds a user and protects the current admin from self-lockout', async () => {
    const calls = fakeApi({
      'GET /auth/me': () => ({ body: { user: admin } }),
      'GET /users': () => ({ body: { users: [admin] } }),
      'POST /users': (b) => ({ status: 201, body: { user: { id: 3, ...(b as object) } } }),
    });
    renderWithProviders(<UsersPage />);
    const user = userEvent.setup();
    expect(await screen.findByText('you')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Disable' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.type(screen.getByLabelText('Email'), 'new@school.test');
    await user.type(screen.getByLabelText('Temporary password'), 'long-enough-pw');
    await user.click(screen.getByRole('button', { name: 'Add user' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        email: 'new@school.test',
        password: 'long-enough-pw',
        role: 'teacher',
      }),
    );
  });
});
