import type { ContractView, ContractsMessage } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { clear, h } from '../dom';
import './skills.css';

/** Today's three SQL jobs and the day streak (Phase 26.5). Progress is the server's; this only shows it. */
export class ContractsView {
  readonly root = h('section', {
    class: 'skills contracts',
    attrs: { 'data-role': 'contracts', role: 'dialog', hidden: '' },
  });
  private last: ContractsMessage | undefined;

  constructor(private readonly i18n: I18n) {
    i18n.onChange(() => this.draw());
    this.draw();
  }

  get hidden(): boolean {
    return Boolean(this.root.hidden);
  }

  set hidden(value: boolean) {
    this.root.hidden = value;
  }

  update(message: ContractsMessage): void {
    this.last = message;
    this.draw();
  }

  private t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  /** What a contract asks, in words. */
  describe(c: ContractView): string {
    switch (c.kind) {
      case 'topic':
        return this.t('contracts.topic', { count: c.count, skill: c.skill ?? '' });
      case 'tier':
        return this.t('contracts.tier', { count: c.count, tier: c.tier ?? 1 });
      case 'clean':
        return this.t('contracts.clean', { count: c.count });
    }
  }

  private draw(): void {
    clear(this.root);
    this.root.setAttribute('aria-label', this.t('contracts.title'));
    const m = this.last;
    this.root.append(
      h(
        'header',
        { class: 'skills-head' },
        h('h2', { text: this.t('contracts.title') }),
        h('button', { text: this.t('contracts.close'), on: { click: () => (this.hidden = true) } }),
      ),
      h('p', { class: 'skills-help', text: this.t('contracts.help') }),
      h('p', {
        class: 'contracts-streak',
        text:
          m && m.streak.days > 0
            ? this.t('contracts.streak', { days: m.streak.days, pct: m.streak.bonusPct })
            : this.t('contracts.noStreak'),
      }),
      m && m.contracts.length
        ? h(
            'ul',
            { class: 'skills-row' },
            ...m.contracts.map((c) =>
              h(
                'li',
                {
                  class: `skills-node ${c.done ? 'skills-mastered' : 'skills-open'}`,
                  attrs: { 'data-contract': c.id, 'data-done': String(c.done) },
                },
                h('div', {
                  class: 'skills-name',
                  text: `${c.done ? '✔ ' : ''}${this.describe(c)}`,
                }),
                h('div', { class: 'skills-state', text: this.t('contracts.xp', { xp: c.xp }) }),
                h(
                  'div',
                  { class: 'skills-progress' },
                  c.done
                    ? this.t('contracts.done')
                    : this.t('contracts.progress', { progress: c.progress, count: c.count }),
                ),
              ),
            ),
          )
        : h('p', { class: 'skills-help', text: this.t('contracts.empty') }),
    );
  }
}
