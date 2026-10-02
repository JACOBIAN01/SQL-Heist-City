import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { admin, fakeApi, renderWithProviders, teacher } from './testing/render';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App shell', () => {
  it('shows the login form when logged out, then the console after signing in', async () => {
    const calls = fakeApi({
      'GET /auth/me': () => ({
        status: 401,
        body: { error: { code: 'unauthorized', message: 'Please log in' } },
      }),
      'POST /auth/login': () => ({ body: { user: teacher } }),
      'GET /questions': () => ({ body: { questions: [] } }),
    });
    renderWithProviders(<App />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 't@school.test');
    await user.type(screen.getByLabelText('Password'), 'secret-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('t@school.test')).toBeTruthy();
    expect(calls.find((c) => c.path === '/auth/login')?.body).toEqual({
      email: 't@school.test',
      password: 'secret-password',
    });
  });

  it('shows the login error message', async () => {
    fakeApi({
      'GET /auth/me': () => ({ status: 401, body: {} }),
      'POST /auth/login': () => ({
        status: 401,
        body: { error: { code: 'invalid_credentials', message: 'Wrong email or password' } },
      }),
    });
    renderWithProviders(<App />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 't@school.test');
    await user.type(screen.getByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Wrong email or password');
  });

  it('hides admin-only navigation from teachers', async () => {
    fakeApi({
      'GET /auth/me': () => ({ body: { user: teacher } }),
      'GET /questions': () => ({ body: { questions: [] } }),
    });
    renderWithProviders(<App />);
    expect(await screen.findByRole('link', { name: 'Questions' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
  });

  it('shows admin-only navigation to admins', async () => {
    fakeApi({
      'GET /auth/me': () => ({ body: { user: admin } }),
      'GET /questions': () => ({ body: { questions: [] } }),
    });
    renderWithProviders(<App />);
    expect(await screen.findByRole('link', { name: 'Users' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeTruthy();
  });
});
