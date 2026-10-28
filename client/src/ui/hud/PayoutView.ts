import { theme } from '../../theme/theme';
import type { PayoutMessage } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { clear, h } from '../dom';
import '../profile/skills.css';

/**
 * The payout screen (Phase 31.4), shown after every heist: what the take was made of, what was
 * banked and the mastery XP it earned. The server sends the numbers; this lays them out.
 */
export class PayoutView {
  readonly panel = h('section', {
    class: 'skills payout-panel',
    attrs: { 'data-role': 'payout', role: 'dialog', hidden: '' },
  });
  private last: PayoutMessage | undefined;

  constructor(private readonly i18n: I18n) {
    i18n.onChange(() => this.draw());
    this.draw();
  }

  get hidden(): boolean {
    return Boolean(this.panel.hidden);
  }

  set hidden(value: boolean) {
    this.panel.hidden = value;
  }

  show(message: PayoutMessage): void {
    this.last = message;
    this.draw();
    this.hidden = false;
  }

  private t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  private draw(): void {
    const m = this.last;
    clear(this.panel);
    this.panel.setAttribute('aria-label', this.t('payout.title'));
    this.panel.appendChild(
      h(
        'header',
        { class: 'skills-head' },
        h('h2', { text: this.t(m?.outcome === 'failed' ? 'payout.failed' : 'payout.title') }),
        h('button', { text: this.t('payout.close'), on: { click: () => (this.hidden = true) } }),
      ),
    );
    if (!m) return;
    const money = (n: number) => theme.money(n);
    this.panel.appendChild(
      h('p', { class: 'skills-help', text: m.bank.replace('bank-', 'Bank ') }),
    );
    const rows = h('table', { class: 'payout-table' });
    for (const line of m.lines)
      rows.appendChild(
        h(
          'tr',
          {},
          h('td', { text: this.t(`payout.${line.id}` as MessageKey) }),
          h('td', { text: money(line.amount) }),
        ),
      );
    rows.appendChild(
      h(
        'tr',
        { class: 'payout-total' },
        h('td', { text: this.t(m.outcome === 'failed' ? 'payout.lostTotal' : 'payout.total') }),
        h('td', { text: money(m.total) }),
      ),
    );
    this.panel.appendChild(rows);
    if (m.mastery > 0)
      this.panel.appendChild(
        h('p', { class: 'skills-help', text: this.t('payout.mastery', { xp: m.mastery }) }),
      );
  }
}
