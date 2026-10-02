import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { THEME_STORAGE_KEY, readThemeChoice } from './theme';
import { ThemeToggle } from './ThemeToggle';

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
afterEach(cleanup);

describe('ThemeToggle', () => {
  it('defaults to Auto (follow the OS)', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('switches to dark and light, remembers the choice, and Auto clears it', async () => {
    render(<ThemeToggle />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '☾ Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await user.click(screen.getByRole('button', { name: '☀ Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(readThemeChoice()).toBe('light');

    await user.click(screen.getByRole('button', { name: 'Auto' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('ignores junk in storage', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(readThemeChoice()).toBe('system');
  });
});
