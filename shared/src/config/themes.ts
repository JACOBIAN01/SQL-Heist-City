import { z } from 'zod';

/**
 * Themes (Phase 34.7): how the game's money, bank names and cast read in a country. A theme changes
 * only what is shown, never a number: the same cash is "$1,500,000" in one theme and "₹15,00,000"
 * in another. Defaults only; the words are data.
 */
export const countryThemeSchema = z.object({
  id: z.string().regex(/^[a-z]{2,10}$/),
  /** Shown in the settings picker. */
  name: z.string().min(1).max(40),
  currency: z.object({
    symbol: z.string().min(1).max(4),
    /** The `Intl` locale whose digit grouping to use (1,500,000 or 15,00,000). */
    grouping: z.string().min(2).max(10),
  }),
  /** Whole phrases to swap in the game's words: bank names, the cast. The longest are applied first. */
  rename: z.record(z.string().min(1), z.string().min(1)).default({}),
});
export type CountryTheme = z.infer<typeof countryThemeSchema>;

export const DEFAULT_COUNTRY_THEMES: readonly CountryTheme[] = [
  {
    id: 'default',
    name: 'Default ($)',
    currency: { symbol: '$', grouping: 'en-US' },
    rename: {},
  },
  {
    id: 'india',
    name: 'India (₹)',
    currency: { symbol: '₹', grouping: 'en-IN' },
    rename: {
      'Corner Savings': 'Gram Sahakari Bank',
      'City Trust': 'Nagar Trust Bank',
      'Metro Capital': 'Mumbai Capital',
      'Grand Reserve': 'Rajdhani Reserve',
      'Federal Vault': 'Rashtriya Vault',
      'Mae Okafor': 'Meera Kapoor',
      Mae: 'Meera',
      'Dev Rao': 'Devansh Rao',
      Inez: 'Isha',
      Walt: 'Waman',
      Brennan: 'Bhatt',
      'Lena Hart': 'Leela Hegde',
      Lena: 'Leela',
      'Marcus Vale': 'Mohan Vyas',
    },
  },
  {
    id: 'uk',
    name: 'United Kingdom (£)',
    currency: { symbol: '£', grouping: 'en-GB' },
    rename: {
      'Corner Savings': 'High Street Savings',
      'City Trust': 'City & Counties Trust',
      'Metro Capital': 'Thames Capital',
      'Grand Reserve': 'Crown Reserve',
      'Federal Vault': 'National Vault',
      'Mae Okafor': 'Maisie Okafor',
      Mae: 'Maisie',
      Inez: 'Imogen',
      Walt: 'Walter',
    },
  },
];

export const COUNTRY_THEME_IDS = DEFAULT_COUNTRY_THEMES.map((t) => t.id) as [string, ...string[]];

export function countryThemeById(
  id: string,
  themes: readonly CountryTheme[] = DEFAULT_COUNTRY_THEMES,
): CountryTheme {
  return themes.find((t) => t.id === id) ?? (themes[0] as CountryTheme);
}

/** An amount as the theme writes it: its symbol, and its digit grouping. */
export function formatThemedMoney(amount: number, theme: CountryTheme): string {
  return `${theme.currency.symbol}${Math.round(amount).toLocaleString(theme.currency.grouping)}`;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Puts a theme's words into a text: every dollar amount in its symbol and grouping, and each phrase
 * of `rename` swapped for its local name (whole words only, longest phrase first).
 */
export function localiseText(text: string, theme: CountryTheme): string {
  let out = text;
  const keys = Object.keys(theme.rename).sort((a, b) => b.length - a.length);
  if (keys.length > 0) {
    const pattern = new RegExp(`\\b(${keys.map(escape).join('|')})\\b`, 'g');
    out = out.replace(pattern, (hit) => theme.rename[hit] ?? hit);
  }
  if (theme.currency.symbol !== '$' || theme.currency.grouping !== 'en-US')
    out = out.replace(/\$(\d[\d,]*)/g, (_all, digits: string) =>
      formatThemedMoney(Number(digits.replace(/,/g, '')), theme),
    );
  return out;
}
