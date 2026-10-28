import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COUNTRY_THEMES,
  COUNTRY_THEME_IDS,
  formatThemedMoney,
  localiseText,
  countryThemeById,
  countryThemeSchema,
} from './themes';

const india = countryThemeById('india');
const uk = countryThemeById('uk');
const plain = countryThemeById('default');

describe('themes (34.7)', () => {
  it('ships a default and two countries, all valid', () => {
    expect(COUNTRY_THEME_IDS).toEqual(['default', 'india', 'uk']);
    for (const t of DEFAULT_COUNTRY_THEMES)
      expect(countryThemeSchema.safeParse(t).success).toBe(true);
  });

  it('falls back to the default for an unknown theme', () => {
    expect(countryThemeById('narnia').id).toBe('default');
  });

  it('writes money in the country’s symbol and digit grouping, without changing the number', () => {
    expect(formatThemedMoney(1_500_000, plain)).toBe('$1,500,000');
    expect(formatThemedMoney(1_500_000, india)).toBe('₹15,00,000');
    expect(formatThemedMoney(1_500_000, uk)).toBe('£1,500,000');
    expect(formatThemedMoney(999.6, plain)).toBe('$1,000');
  });

  it('swaps bank names and the cast, whole words only, longest first', () => {
    expect(localiseText('Mae Okafor works at Corner Savings.', india)).toBe(
      'Meera Kapoor works at Gram Sahakari Bank.',
    );
    expect(localiseText('Mae says hi', india)).toBe('Meera says hi');
    expect(localiseText('Maelstrom', india)).toBe('Maelstrom'); // not inside another word
    expect(localiseText('Federal Vault is shut.', uk)).toBe('National Vault is shut.');
  });

  it('turns dollar amounts in a text into the theme’s money', () => {
    expect(localiseText('Banked $2,500,000 and +$250.', india)).toBe(
      'Banked ₹25,00,000 and +₹250.',
    );
    expect(localiseText('Cost $50', uk)).toBe('Cost £50');
  });

  it('leaves the default theme’s text alone', () => {
    const text = 'Mae Okafor at Corner Savings: $1,500';
    expect(localiseText(text, plain)).toBe(text);
  });

  it('leaves words alone that a theme has no name for', () => {
    expect(localiseText('Dev Rao audits City Trust', uk)).toBe(
      'Dev Rao audits City & Counties Trust',
    );
  });
});
