import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_KEYS } from '@heist/shared';
import { I18n } from '../../i18n/I18n';
import { SettingsStore } from '../../settings/SettingsStore';
import { SettingsPanel } from './SettingsPanel';

function panel() {
  const store = new SettingsStore(undefined);
  const i18n = new I18n('en');
  const p = new SettingsPanel(store, i18n);
  p.open();
  return { p, store, i18n };
}
const click = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === text)?.click();
const press = (root: HTMLElement, code: string) =>
  root.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));

afterEach(() => document.body.replaceChildren());

describe('SettingsPanel', () => {
  it('rebinds an action to the next key pressed, and can put it back', () => {
    const { p, store } = panel();
    const row = () => p.root.querySelector('[data-action="use"]') as HTMLElement;
    (row().querySelector('.settings-key button') as HTMLButtonElement).click();
    expect(p.root.textContent).toContain('Press a key');
    press(p.root, 'KeyG');
    expect(store.current.keys.use).toEqual(['KeyG']);
    click(row(), 'Reset keys');
    expect(store.current.keys.use).toBeUndefined();
  });

  it('refuses keys the game keeps, and marks two actions sharing a key', () => {
    const { p, store } = panel();
    const first = () =>
      p.root.querySelector('[data-action="map"] .settings-key button') as HTMLButtonElement;
    first().click();
    press(p.root, 'F5');
    expect(store.current.keys.map).toBeUndefined();
    expect(p.root.textContent).toContain('kept by the game');
    first().click();
    press(p.root, DEFAULT_KEYS.profile[0] as string);
    expect(p.root.querySelectorAll('.settings-clash').length).toBe(2);
    expect(p.root.textContent).toContain('do two things');
  });

  it('Esc cancels a capture first, then closes', () => {
    const { p } = panel();
    (p.root.querySelector('.settings-key button') as HTMLButtonElement).click();
    press(p.root, 'Escape');
    expect(p.isOpen).toBe(true);
    press(p.root, 'Escape');
    expect(p.isOpen).toBe(false);
  });

  it('changes a slider, the language, and resets everything', () => {
    const { p, store, i18n } = panel();
    const slider = p.root.querySelector('input[type="range"]') as HTMLInputElement;
    slider.value = '2';
    slider.dispatchEvent(new Event('change'));
    expect(store.current.look.sensitivity).toBe(2);
    click(p.root, 'Language');
    const select = p.root.querySelector('select') as HTMLSelectElement;
    select.value = 'hi';
    select.dispatchEvent(new Event('change'));
    expect(i18n.locale).toBe('hi');
    expect(store.current.locale).toBe('hi');
    click(p.root, 'Reset everything to the defaults');
    expect(store.current.look.sensitivity).toBe(1);
  });

  it('has no accessibility violations on any tab (axe)', async () => {
    const { p } = panel();
    for (const tab of ['Controls', 'Sound', 'Graphics', 'Accessibility', 'Language']) {
      click(p.root, tab);
      const result = await axe.run(p.root, { rules: { 'color-contrast': { enabled: false } } });
      expect(
        result.violations.map((v) => `${v.id}: ${v.help}`),
        tab,
      ).toEqual([]);
    }
  });
});
