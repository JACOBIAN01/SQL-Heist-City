import { useThemeChoice, type ThemeChoice } from './theme';

const OPTIONS: { value: ThemeChoice; label: string; title: string }[] = [
  { value: 'light', label: '☀ Light', title: 'Light mode' },
  { value: 'dark', label: '☾ Dark', title: 'Dark mode' },
  { value: 'system', label: 'Auto', title: 'Follow the computer’s setting' },
];

export function ThemeToggle() {
  const [choice, setChoice] = useThemeChoice();
  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={choice === o.value}
          onClick={() => setChoice(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
