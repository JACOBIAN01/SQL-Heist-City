import type { BoardSummary, LeaderboardMessage } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { clear, h } from '../dom';
import '../profile/skills.css';

/**
 * Optimisation leaderboards (Phase 34.4): after a correct write query, how lean it was and where
 * that puts the student among their class and everyone. A toast says it at once; this panel (Z) keeps
 * the latest tables to read.
 */
export class LeaderboardView {
  readonly panel = h('section', {
    class: 'skills leaderboard-panel',
    attrs: { 'data-role': 'leaderboard', role: 'dialog', hidden: '' },
  });
  private last: LeaderboardMessage | undefined;

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

  /** The line shown as a toast when a query is solved. */
  toastFor(m: LeaderboardMessage): string {
    const place = m.class ?? m.global;
    return this.i18n.t(m.newBest ? 'board.toastBest' : 'board.toast', {
      rank: place.rank,
      of: place.of,
      scanned: m.you.scanned,
      length: m.you.length,
    });
  }

  update(message: LeaderboardMessage): void {
    this.last = message;
    this.draw();
  }

  private t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  private table(title: string, board: BoardSummary): HTMLElement {
    const rows = h('table', { class: 'payout-table' });
    for (const r of board.top)
      rows.appendChild(
        h(
          'tr',
          { class: r.you ? 'payout-total' : '' },
          h('td', { text: `${r.rank}. ${r.name}${r.you ? ` (${this.t('lb.you')})` : ''}` }),
          h('td', { text: this.t('lb.cost', { scanned: r.scanned, length: r.length }) }),
        ),
      );
    return h(
      'section',
      { attrs: { 'data-board': title } },
      h('h3', { text: `${title} · ${this.t('lb.place', { rank: board.rank, of: board.of })}` }),
      rows,
    );
  }

  private draw(): void {
    clear(this.panel);
    this.panel.setAttribute('aria-label', this.t('lb.title'));
    this.panel.appendChild(
      h(
        'header',
        { class: 'skills-head' },
        h('h2', { text: this.t('lb.title') }),
        h('button', { text: this.t('lb.close'), on: { click: () => (this.hidden = true) } }),
      ),
    );
    const m = this.last;
    if (!m) {
      this.panel.appendChild(h('p', { class: 'skills-help', text: this.t('lb.none') }));
      return;
    }
    this.panel.appendChild(
      h('p', {
        class: 'skills-help',
        text: this.t('lb.yours', {
          question: m.question,
          scanned: m.you.scanned,
          length: m.you.length,
        }),
      }),
    );
    if (m.class) this.panel.appendChild(this.table(this.t('lb.class'), m.class));
    this.panel.appendChild(this.table(this.t('lb.everyone'), m.global));
  }
}
