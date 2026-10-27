import type { CollectionMessage } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import { clear, h } from '../dom';
import '../profile/skills.css';

/**
 * The student's data-chip collection (Phase 30.3): the SQL trivia cards found so far and how many
 * chips there are in all. What is found is decided and kept by the server.
 */
export class CollectionView {
  readonly panel = h('section', {
    class: 'skills collection-panel',
    attrs: { 'data-role': 'collection', role: 'dialog', hidden: '' },
  });
  private last: CollectionMessage | undefined;

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

  update(message: CollectionMessage): void {
    this.last = message;
    this.draw();
  }

  private draw(): void {
    const m = this.last;
    clear(this.panel);
    this.panel.setAttribute('aria-label', this.i18n.t('collection.title'));
    this.panel.appendChild(
      h(
        'header',
        { class: 'skills-head' },
        h('h2', { text: this.i18n.t('collection.title') }),
        h('button', {
          text: this.i18n.t('collection.close'),
          on: { click: () => (this.hidden = true) },
        }),
      ),
    );
    if (!m || m.total === 0) {
      this.panel.appendChild(
        h('p', { class: 'skills-help', text: this.i18n.t('collection.none') }),
      );
      return;
    }
    this.panel.appendChild(
      h('p', {
        class: 'skills-help',
        text: this.i18n.t('collection.count', { found: m.found.length, total: m.total }),
        attrs: { role: 'status' },
      }),
    );
    for (const card of m.found)
      this.panel.appendChild(
        h(
          'article',
          { class: 'collection-card' },
          h('h3', { text: card.title }),
          h('p', { text: card.fact }),
        ),
      );
  }
}
