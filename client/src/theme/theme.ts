import {
  DEFAULT_COUNTRY_THEMES,
  countryThemeById,
  formatThemedMoney,
  localiseText,
  type CountryTheme,
} from '@heist/shared';

/**
 * The country look in force (Phase 34.7): how money, bank names and the cast read. One for the page,
 * set from the player's settings; views ask it for text rather than formatting money themselves.
 * Only what is shown changes, never a number the server sent.
 */
class ThemeState {
  private current: CountryTheme = DEFAULT_COUNTRY_THEMES[0] as CountryTheme;

  get id(): string {
    return this.current.id;
  }

  set(id: string): void {
    this.current = countryThemeById(id);
  }

  /** An amount as the theme writes it ("$1,500", "₹1,500"). */
  money(amount: number): string {
    return formatThemedMoney(amount, this.current);
  }

  /** A text with the theme's money and names put in. */
  text(text: string): string {
    return localiseText(text, this.current);
  }
}

export const theme = new ThemeState();
