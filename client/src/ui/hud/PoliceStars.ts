import type { PoliceMessage } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import { clear, h } from '../dom';
import './hud.css';

/**
 * The wanted level (Phase 29.4): a row of stars under the minimap that fills with the server's
 * count and flashes while the police are searching. The server owns the number; this only shows it.
 */
export class PoliceStars {
  readonly root = h('div', {
    class: 'wanted',
    attrs: { 'data-role': 'wanted', role: 'status', hidden: '' },
  });

  constructor(private readonly i18n: I18n) {}

  update(message: PoliceMessage): void {
    clear(this.root);
    this.root.hidden = message.stars <= 0;
    if (message.stars <= 0) return;
    this.root.setAttribute('aria-label', this.i18n.t('wanted.label', { stars: message.stars }));
    for (let i = 0; i < message.max; i++)
      this.root.append(
        h('span', {
          class: i < message.stars ? 'wanted-star on' : 'wanted-star',
          text: '★',
          attrs: { 'aria-hidden': 'true' },
        }),
      );
  }
}
