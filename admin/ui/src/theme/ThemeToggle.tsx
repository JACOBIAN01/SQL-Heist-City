import { useThemeChoice } from './theme';

/** OS preference, used until the user picks a theme explicitly. */
function systemPrefersDark(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/** One icon button: shows the mode you'd switch to (moon in light mode, sun in dark mode). */
export function ThemeToggle() {
  const [choice, setChoice] = useThemeChoice();
  const isDark = choice === 'dark' || (choice === 'system' && systemPrefersDark());
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => setChoice(isDark ? 'light' : 'dark')}
    >
      <span aria-hidden="true">{isDark ? '☀' : '☾'}</span>
    </button>
  );
}
