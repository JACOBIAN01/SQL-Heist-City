import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

type Handler = (body: unknown, url: URL) => { status?: number; body?: unknown } | undefined;

/**
 * Fake /api: register handlers by "METHOD /path" (path without /api, no
 * query string). Unhandled calls fail loudly so tests can't pass by accident.
 */
export function fakeApi(routes: Record<string, Handler>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, 'http://admin.test');
      const method = init.method ?? 'GET';
      const path = url.pathname.replace(/^\/api/, '');
      const body =
        typeof init.body === 'string' &&
        init.headers &&
        (init.headers as Record<string, string>)['content-type'] === 'application/json'
          ? JSON.parse(init.body)
          : init.body;
      calls.push({ method, path, body });
      const handler = routes[`${method} ${path}`];
      if (!handler) throw new Error(`unhandled fake API call: ${method} ${path}`);
      const result = handler(body, url) ?? {};
      const status = result.status ?? 200;
      return new Response(status === 204 ? null : JSON.stringify(result.body ?? {}), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

export function renderWithProviders(ui: ReactElement, path = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

export const teacher = {
  id: 1,
  email: 't@school.test',
  role: 'teacher',
  disabled: false,
  createdAt: '',
} as const;
export const admin = {
  id: 2,
  email: 'a@school.test',
  role: 'admin',
  disabled: false,
  createdAt: '',
} as const;
