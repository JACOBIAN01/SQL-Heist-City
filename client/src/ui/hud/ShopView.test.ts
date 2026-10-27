import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShopMessage } from '@heist/shared';
import { I18n } from '../../i18n/I18n';
import { ShopView } from './ShopView';

afterEach(() => document.body.replaceChildren());

const msg = (over: Partial<ShopMessage> = {}): ShopMessage => ({
  t: 'shop',
  offers: [
    { item: 'armour', price: 2000 },
    { item: 'ammo', price: 500 },
  ],
  armour: 0,
  armourMax: 100,
  ...over,
});

const make = () => {
  const send = vi.fn();
  const v = new ShopView(new I18n('en'), send);
  document.body.append(v.panel, v.bar);
  return { v, send };
};

describe('ShopView', () => {
  it('lists what is for sale and asks the server to buy, nothing more', () => {
    const { v, send } = make();
    v.update(msg());
    v.open();
    expect(v.panel.textContent).toContain('$2,000');
    v.panel.querySelector<HTMLButtonElement>('[data-item="ammo"]')?.click();
    expect(send).toHaveBeenCalledWith({ t: 'shop_buy', item: 'ammo' });
  });

  it('says what happened to the last purchase', () => {
    const { v } = make();
    v.update(msg({ result: { item: 'armour', ok: false, reason: 'no_cash' } }));
    expect(v.panel.querySelector('[role="alert"]')?.textContent).toContain('enough cash');
    v.update(msg({ result: { item: 'armour', ok: true }, armour: 50 }));
    expect(v.panel.textContent).toContain('You bought');
  });

  it('shows the armour bar only while you wear armour', () => {
    const { v } = make();
    v.update(msg());
    expect(v.bar.hidden).toBe(true);
    v.update(msg({ armour: 50 }));
    expect(v.bar.hidden).toBe(false);
    expect(v.bar.textContent).toContain('50');
  });
});
