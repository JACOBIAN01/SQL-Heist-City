import { theme } from '../../theme/theme';
import type { ShopItem, ShopMessage, UpgradeId } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { clear, h } from '../dom';
import '../profile/skills.css';

/**
 * The street shop's window (Phase 29.6) and the armour bar. The server owns the cash, the prices and
 * the armour; this shows what it sent and asks to buy.
 */
export class ShopView {
  readonly panel = h('section', {
    class: 'skills shop-panel',
    attrs: { 'data-role': 'shop', role: 'dialog', hidden: '' },
  });
  /** Armour left, under the minimap while you wear any. */
  readonly bar = h('div', {
    class: 'armour-bar',
    attrs: { 'data-role': 'armour', role: 'status', hidden: '' },
  });
  private last: ShopMessage | undefined;

  constructor(
    private readonly i18n: I18n,
    private readonly send: (
      message: { t: 'shop_buy'; item: ShopItem } | { t: 'upgrade_buy'; upgrade: UpgradeId },
    ) => void,
  ) {
    i18n.onChange(() => this.draw());
    this.draw();
  }

  get hidden(): boolean {
    return Boolean(this.panel.hidden);
  }

  set hidden(value: boolean) {
    this.panel.hidden = value;
  }

  open(): void {
    this.hidden = false;
  }

  update(message: ShopMessage): void {
    this.last = message;
    this.draw();
  }

  private t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  private draw(): void {
    const m = this.last;
    this.bar.hidden = !m || m.armour <= 0;
    if (m) this.bar.textContent = this.t('shop.armour', { armour: m.armour, max: m.armourMax });
    clear(this.panel);
    this.panel.setAttribute('aria-label', this.t('shop.title'));
    this.panel.appendChild(
      h(
        'header',
        { class: 'skills-head' },
        h('h2', { text: this.t('shop.title') }),
        h('button', { text: this.t('shop.close'), on: { click: () => (this.hidden = true) } }),
      ),
    );
    if (!m) return;
    this.panel.appendChild(h('p', { class: 'skills-help', text: this.t('shop.help') }));
    if (m.result)
      this.panel.appendChild(
        h('p', {
          class: m.result.ok ? 'skills-help' : 'menu-error',
          text: m.result.ok
            ? this.t('shop.bought', { item: this.t(`shop.item.${m.result.item}` as MessageKey) })
            : this.t(`shop.denied.${m.result.reason ?? 'closed'}` as MessageKey),
          attrs: { role: m.result.ok ? 'status' : 'alert' },
        }),
      );
    if (m.upgradeResult)
      this.panel.appendChild(
        h('p', {
          class: m.upgradeResult.ok ? 'skills-help' : 'menu-error',
          text: m.upgradeResult.ok
            ? this.t('shop.upgraded', {
                upgrade: this.t(`upgrade.${m.upgradeResult.upgrade}` as MessageKey),
              })
            : this.t(`upgrade.denied.${m.upgradeResult.reason ?? 'closed'}` as MessageKey),
          attrs: { role: m.upgradeResult.ok ? 'status' : 'alert' },
        }),
      );
    for (const offer of m.offers)
      this.panel.appendChild(
        h(
          'div',
          { class: 'shop-offer' },
          h('span', {
            text: `${this.t(`shop.item.${offer.item}` as MessageKey)} · ${theme.money(offer.price)}`,
          }),
          h('button', {
            text: this.t('shop.buy'),
            attrs: { 'data-item': offer.item },
            on: { click: () => this.send({ t: 'shop_buy', item: offer.item }) },
          }),
        ),
      );

    if (m.upgrades.length === 0) return;
    this.panel.appendChild(h('h3', { text: this.t('shop.upgrades') }));
    this.panel.appendChild(h('p', { class: 'skills-help', text: this.t('shop.upgradesHelp') }));
    for (const u of m.upgrades)
      this.panel.appendChild(
        h(
          'div',
          { class: 'shop-offer' },
          h(
            'span',
            { attrs: { 'data-upgrade': u.id } },
            `${this.t(`upgrade.${u.id}` as MessageKey)} · ${u.level}/${u.max}`,
          ),
          u.price === undefined
            ? h('span', { text: this.t('shop.maxed') })
            : h('button', {
                text: theme.text(
                  this.t('shop.upgradeFor', { price: u.price.toLocaleString('en-US') }),
                ),
                attrs: { 'data-upgrade-buy': u.id },
                on: { click: () => this.send({ t: 'upgrade_buy', upgrade: u.id }) },
              }),
        ),
      );
  }
}
