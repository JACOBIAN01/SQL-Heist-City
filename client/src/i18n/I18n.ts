import type { Locale } from '@heist/shared';
import { en, type MessageKey } from './en';
import { hi } from './hi';

type Catalog = Readonly<Partial<Record<MessageKey, string>>>;

const CATALOGS: Readonly<Record<Locale, Catalog>> = { en, hi };

export type Params = Readonly<Record<string, string | number>>;

/**
 * Looks up interface text in the player's language, falling back to English per key.
 * Pattern: Observer (locale changes) — Why: screens already on show redraw their text when the
 * player picks another language, without each one knowing about the settings panel.
 */
export class I18n {
  private readonly listeners = new Set<() => void>();

  constructor(private current: Locale = 'en') {}

  get locale(): Locale {
    return this.current;
  }

  setLocale(locale: Locale): void {
    if (locale === this.current) return;
    this.current = locale;
    for (const listener of [...this.listeners]) listener();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** `{name}` markers in the text are replaced from `params`; an unknown marker is left as written. */
  t = (key: MessageKey, params?: Params): string => {
    const text = CATALOGS[this.current][key] ?? en[key];
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in params ? String(params[name]) : whole,
    );
  };
}

/** The one used when nothing is passed: English, so existing screens and tests read as before. */
export const defaultI18n = new I18n('en');
