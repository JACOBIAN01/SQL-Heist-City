import type { LeagueMessage } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { clear, h } from '../dom';
import './skills.css';

/** This week's class league: the top ten, with learning and cash points shown apart (Phase 26.6). */
export class LeagueView {
  readonly root = h('section', {
    class: 'skills league',
    attrs: { 'data-role': 'league', role: 'dialog', hidden: '' },
  });
  private last: LeagueMessage | undefined;

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

  update(message: LeagueMessage): void {
    this.last = message;
    this.draw();
  }

  private t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  private draw(): void {
    clear(this.root);
    this.root.setAttribute('aria-label', this.t('league.title'));
    const m = this.last;
    this.root.append(
      h(
        'header',
        { class: 'skills-head' },
        h('h2', { text: this.t('league.title') }),
        h('button', { text: this.t('league.close'), on: { click: () => (this.hidden = true) } }),
      ),
      h('p', { class: 'skills-help', text: this.t('league.help') }),
      ...(m
        ? [h('p', { class: 'skills-help', text: this.t('league.week', { start: m.week.start }) })]
        : []),
      !m
        ? h('p', { class: 'skills-help', text: this.t('league.none') })
        : m.rows.length === 0
          ? h('p', { class: 'skills-help', text: this.t('league.empty') })
          : h(
              'ol',
              { class: 'league-rows' },
              ...m.rows.map((r) =>
                h(
                  'li',
                  { class: r.you ? 'league-you' : '', attrs: { value: String(r.rank) } },
                  h('strong', { text: r.you ? `${r.name} (${this.t('league.you')})` : r.name }),
                  ` — ${this.t('league.points', { points: r.points })} `,
                  h('span', {
                    class: 'skills-progress',
                    text: this.t('league.split', {
                      learning: r.learningPoints,
                      cash: r.cashPoints,
                    }),
                  }),
                ),
              ),
            ),
    );
  }
}
