import type { StoryMessage } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { clear, h } from '../dom';
import '../profile/skills.css';

/**
 * The student's story journal (Phase 32.2): the five chains, who the fixer is, what to do now and
 * the pages of evidence collected. The server holds the progress; this shows what it sent.
 */
export class StoryView {
  readonly panel = h('section', {
    class: 'skills story-panel',
    attrs: { 'data-role': 'story', role: 'dialog', hidden: '' },
  });
  private last: StoryMessage | undefined;

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

  update(message: StoryMessage): void {
    this.last = message;
    this.draw();
  }

  private t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  private draw(): void {
    const m = this.last;
    clear(this.panel);
    this.panel.setAttribute('aria-label', this.t('story.title'));
    this.panel.appendChild(
      h(
        'header',
        { class: 'skills-head' },
        h('h2', { text: this.t('story.title') }),
        h('button', { text: this.t('story.close'), on: { click: () => (this.hidden = true) } }),
      ),
    );
    if (!m || m.chains.length === 0) {
      this.panel.appendChild(h('p', { class: 'skills-help', text: this.t('story.none') }));
      return;
    }
    this.panel.appendChild(
      h('p', {
        class: 'skills-help',
        text: this.t('story.pages', { pages: m.pages, total: m.chains.length }),
        attrs: { role: 'status' },
      }),
    );
    for (const c of m.chains)
      this.panel.appendChild(
        h(
          'article',
          { class: `story-chain story-${c.state}`, attrs: { 'data-bank': c.bank } },
          h('h3', {
            text: c.state === 'locked' ? `${c.name} · ${this.t('story.locked')}` : c.name,
          }),
          h('p', { class: 'skills-help', text: `${c.fixer.name}, ${c.fixer.role}` }),
          c.current
            ? h(
                'p',
                {},
                h('b', {
                  text: `${this.t('story.step', { n: c.step + 1, total: c.total })}: ${c.current.title}. `,
                }),
                c.current.text,
              )
            : h('span'),
          c.page ? h('p', { class: 'story-page', text: `“${c.page}”` }) : h('span'),
        ),
      );
  }
}
