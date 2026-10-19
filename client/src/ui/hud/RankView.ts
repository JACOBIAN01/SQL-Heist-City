import type { ProgressMessage } from '@heist/shared';
import { h } from '../dom';

/** The student's rank and the bar to the next one, with a "+N XP" flash when they earn (Phase 26.1). */
export class RankView {
  readonly root = h('div', { class: 'hud-rank', attrs: { 'data-role': 'rank', hidden: '' } });
  private readonly name = h('div', { class: 'hud-rank-name' });
  private readonly fill = h('div', { class: 'hud-rank-fill' });
  private readonly bar = h(
    'div',
    { class: 'hud-rank-bar', attrs: { role: 'progressbar', 'aria-label': 'XP to the next rank' } },
    this.fill,
  );
  private readonly flash = h('div', { class: 'hud-rank-flash', attrs: { 'aria-live': 'polite' } });
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(parent: HTMLElement) {
    this.root.append(this.name, this.bar, this.flash);
    parent.appendChild(this.root);
  }

  update(message: ProgressMessage): void {
    const p = message.progress;
    this.root.hidden = false;
    this.name.textContent = p.nextRank
      ? `${p.rank} · ${p.xp} XP`
      : `${p.rank} · ${p.xp} XP (top rank)`;
    const share = p.span > 0 ? Math.min(1, p.into / p.span) : 1;
    this.fill.style.width = `${Math.round(share * 100)}%`;
    this.bar.setAttribute('aria-valuemin', '0');
    this.bar.setAttribute('aria-valuemax', String(p.span || 1));
    this.bar.setAttribute('aria-valuenow', String(p.span > 0 ? p.into : 1));
    if (p.nextRank)
      this.bar.setAttribute('aria-valuetext', `${p.span - p.into} XP to ${p.nextRank}`);
    if (message.gained) {
      this.flash.textContent = `+${message.gained.amount} XP`;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => (this.flash.textContent = ''), 2500);
    }
  }
}
