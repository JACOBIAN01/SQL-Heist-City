import { useCallback, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'heist-admin-theme';

/** Saved choice; "system" when nothing (valid) is stored or storage is blocked. */
export function readThemeChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Applies a choice to <html data-theme> (CSS picks the palette from it) and
 * remembers it. "system" removes the attribute so the OS setting decides.
 */
export function applyThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Private mode / blocked storage: the theme still applies for this visit.
  }
}

export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice);
  const update = useCallback((next: ThemeChoice) => {
    applyThemeChoice(next);
    setChoice(next);
  }, []);
  return [choice, update];
}
