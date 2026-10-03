import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', root: 'shared', environment: 'node' } },
      { test: { name: 'server', root: 'server', environment: 'node' } },
      {
        test: { name: 'admin', root: 'admin', environment: 'node', include: ['src/**/*.test.ts'] },
      },
      {
        test: {
          name: 'admin-ui',
          root: 'admin/ui',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        test: {
          name: 'client',
          root: 'client',
          environment: 'jsdom',
          include: ['src/**/*.test.ts'],
        },
      },
    ],
  },
});
