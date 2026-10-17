import { describe, expect, it, vi } from 'vitest';
import { I18n } from './I18n';
import { en, type MessageKey } from './en';
import { hi } from './hi';

describe('I18n', () => {
  it('puts values into {markers} and leaves unknown ones alone', () => {
    const i = new I18n('en');
    expect(i.t('age.hello', { name: 'Ana' })).toContain('Hi Ana.');
    expect(i.t('age.hello')).toContain('{name}');
  });

  it('switches language at runtime, tells listeners, and falls back to English per key', () => {
    const i = new I18n('en');
    const seen = vi.fn();
    i.onChange(seen);
    i.setLocale('hi');
    i.setLocale('hi');
    expect(seen).toHaveBeenCalledTimes(1);
    expect(i.t('menu.signOut')).toBe(hi['menu.signOut']);
    expect(i.t('menu.noData')).toBe(en['menu.noData']);
  });

  it('keeps every {marker} of the English text in a translation', () => {
    const markers = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const [key, text] of Object.entries(hi)) {
      expect(markers(text), key).toBe(markers(en[key as MessageKey]));
    }
  });

  it('has a label for every action and palette the settings know', async () => {
    const { ACTIONS, PALETTES } = await import('@heist/shared');
    for (const a of ACTIONS) expect(en[`action.${a}` as MessageKey], a).toBeTruthy();
    for (const p of PALETTES) expect(en[`palette.${p}` as MessageKey], p).toBeTruthy();
  });
});
