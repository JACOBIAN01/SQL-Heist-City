import type { AccountApi } from '../net/account';
import { I18n } from '../i18n/I18n';
import { applyAccessibility } from './accessibility';
import { SettingsStore } from './SettingsStore';
import './accessibility.css';

/**
 * The player's settings for a page: the store (browser copy first, account copy once known), the
 * language that follows it, and the page-wide accessibility choices applied as they change. The
 * menu and the game both start here, so a choice made in one is in force in the other.
 */
export function startSettings(account: AccountApi): { store: SettingsStore; i18n: I18n } {
  const store = new SettingsStore(undefined, {
    load: () => account.loadSettings(),
    save: (settings) => account.saveSettings(settings),
  });
  const i18n = new I18n(store.current.locale);
  const apply = () => {
    applyAccessibility(store.current);
    i18n.setLocale(store.current.locale);
    document.documentElement.lang = store.current.locale;
  };
  apply();
  store.subscribe(apply);
  // "Follow my device" for motion: react when the device's own choice changes.
  if (typeof matchMedia === 'function')
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', apply);
  addEventListener('pagehide', () => void store.flush());
  void store.fromAccount();
  return { store, i18n };
}
