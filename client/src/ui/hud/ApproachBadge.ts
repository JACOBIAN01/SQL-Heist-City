import type { ApproachState } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import { h } from '../dom';
import './hud.css';

/** The "STEALTH" badge (Phase 30.7): shown while the server has you moving quietly. */
export class ApproachBadge {
  readonly root = h('div', {
    class: 'approach-badge',
    attrs: { 'data-role': 'approach', role: 'status', hidden: '' },
  });

  constructor(private readonly i18n: I18n) {}

  update(state: ApproachState): void {
    this.root.hidden = state.mode !== 'stealth';
    this.root.textContent = this.i18n.t('approach.stealth');
  }
}
