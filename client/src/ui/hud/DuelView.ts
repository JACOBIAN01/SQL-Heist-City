import type { DuelMessage } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { clear, h } from '../dom';

/**
 * SQL Quick Draw (Phase 28.3): the strip at the top of the screen that says where the duel
 * stands. When a new draw opens it asks for the question to be opened (the server decides when,
 * and judges the answers); when the draw ends it asks for the pop-up to be closed.
 */
export class DuelView {
  readonly root = h('div', {
    class: 'duel',
    attrs: { 'data-role': 'duel', role: 'status', 'aria-live': 'polite', hidden: '' },
  });
  private last: DuelMessage | undefined;
  private lastDraw = 0;

  constructor(
    private readonly i18n: I18n,
    private readonly hooks: { onDraw(): void; onEnd(): void },
  ) {
    i18n.onChange(() => this.draw());
  }

  update(message: DuelMessage): void {
    const before = this.last;
    this.last = message;
    this.draw();
    if (message.state === 'draw' && message.drawId !== this.lastDraw) {
      this.lastDraw = message.drawId;
      this.hooks.onDraw();
    } else if (before?.state === 'draw' && message.state !== 'draw') this.hooks.onEnd();
  }

  private t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  private line(m: DuelMessage): string {
    const opponent = m.opponent ?? '';
    const p = {
      opponent,
      you: m.you,
      them: m.them,
      draw: m.draw,
      draws: m.draws,
      seconds: m.seconds,
    };
    switch (m.state) {
      case 'waiting':
        return this.t('duel.waiting');
      case 'countdown':
        return this.t('duel.countdown', p);
      case 'draw':
        return this.t('duel.draw', p);
      case 'between':
        return this.t(
          m.last === 'you' ? 'duel.wonDraw' : m.last === 'them' ? 'duel.lostDraw' : 'duel.noDraw',
          p,
        );
      case 'over':
        return this.t(
          m.result === 'win' ? 'duel.won' : m.result === 'lose' ? 'duel.lost' : 'duel.tied',
          p,
        );
    }
  }

  private draw(): void {
    clear(this.root);
    const m = this.last;
    this.root.hidden = !m;
    if (!m) return;
    this.root.setAttribute('aria-label', this.t('duel.title'));
    this.root.className = `duel duel-${m.state}${m.state === 'over' && m.result ? ` duel-${m.result}` : ''}`;
    this.root.append(
      h('strong', { class: 'duel-title', text: this.t('duel.title') }),
      h('span', { class: 'duel-line', text: this.line(m) }),
    );
  }
}
