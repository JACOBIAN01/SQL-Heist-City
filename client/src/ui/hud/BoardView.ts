import type { JobKind } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { clear, h } from '../dom';
import '../profile/skills.css';

/**
 * A district's contract board (Phase 31.2): the contracts on offer, each with what it asks. The
 * player picks one; the server checks they stand at the board and sets it up.
 */
export class BoardView {
  readonly panel = h('section', {
    class: 'skills board-panel',
    attrs: { 'data-role': 'board', role: 'dialog', hidden: '' },
  });
  private board = '';
  private kinds: readonly JobKind[] = [];

  constructor(
    private readonly i18n: I18n,
    private readonly send: (message: { t: 'job_take'; board: string; kind: JobKind }) => void,
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

  open(board: string, kinds: readonly JobKind[]): void {
    this.board = board;
    this.kinds = kinds;
    this.draw();
    this.hidden = false;
  }

  private t(key: MessageKey): string {
    return this.i18n.t(key);
  }

  private draw(): void {
    clear(this.panel);
    this.panel.setAttribute('aria-label', this.t('board.title'));
    this.panel.appendChild(
      h(
        'header',
        { class: 'skills-head' },
        h('h2', { text: this.t('board.title') }),
        h('button', { text: this.t('board.close'), on: { click: () => (this.hidden = true) } }),
      ),
    );
    this.panel.appendChild(h('p', { class: 'skills-help', text: this.t('board.help') }));
    for (const kind of this.kinds)
      this.panel.appendChild(
        h(
          'article',
          { class: 'board-contract' },
          h('h3', { text: this.t(`board.${kind}` as MessageKey) }),
          h('p', { text: this.t(`board.${kind}.what` as MessageKey) }),
          h('button', {
            text: this.t('board.take'),
            attrs: { 'data-kind': kind },
            on: {
              click: () => {
                this.send({ t: 'job_take', board: this.board, kind });
                this.hidden = true;
              },
            },
          }),
        ),
      );
  }
}
