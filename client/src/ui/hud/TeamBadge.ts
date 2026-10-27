import type { TeamMessage } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import { h } from '../dom';
import './hud.css';

/** Which side you are on in a cops-and-robbers room (Phase 34.1): a badge that stays on screen. */
export class TeamBadge {
  readonly root = h('div', {
    class: 'team-badge',
    attrs: { 'data-role': 'team', role: 'status', hidden: '' },
  });

  constructor(private readonly i18n: I18n) {}

  update(message: TeamMessage): void {
    this.root.hidden = false;
    this.root.dataset.team = message.role;
    this.root.textContent = this.i18n.t(message.role === 'cop' ? 'team.cop' : 'team.robber');
  }
}
