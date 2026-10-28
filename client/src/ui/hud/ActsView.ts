import { theme } from '../../theme/theme';
import type { ActsMessage } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { h } from '../dom';
import './hud.css';

/**
 * Where you are in a three-act heist (Phase 31.1): setup, the heist, the getaway. The server decides
 * the act and holds the intel; this shows them.
 */
export class ActsView {
  readonly root = h('div', {
    class: 'acts-hud',
    attrs: { 'data-role': 'acts', role: 'status', hidden: '' },
  });
  private hideAt = Infinity;
  private shown = false;

  constructor(private readonly i18n: I18n) {}

  update(message: ActsMessage, now: number): void {
    this.shown = message.act !== 'none';
    // A finished heist stays up a few seconds.
    this.hideAt = message.act === 'complete' ? now + 6000 : Infinity;
    this.root.hidden = !this.shown;
    if (!this.shown) return;
    const params = {
      bank: message.bank ?? '',
      intel: message.intel,
      max: message.intelMax,
      take: message.take.toLocaleString('en-US'),
    };
    this.root.textContent = theme.text(this.i18n.t(`acts.${message.act}` as MessageKey, params));
  }

  frame(now: number): void {
    if (this.shown && now >= this.hideAt) {
      this.shown = false;
      this.root.hidden = true;
    }
  }
}
