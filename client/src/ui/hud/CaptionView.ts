import { clear, h } from '../dom';
import type { Caption } from '../../audio/CaptionedAudio';

const ARROW = { ahead: '↑', behind: '↓', left: '←', right: '→' } as const;

/** Sound captions at the bottom of the screen: the last few, each gone after a moment. Announced politely to screen readers. */
export class CaptionView {
  readonly root = h('div', {
    class: 'hud-captions',
    attrs: { role: 'log', 'aria-live': 'polite', 'aria-label': 'Sound captions' },
  });
  private readonly lines: { el: HTMLElement; until: number }[] = [];

  constructor(
    parent: HTMLElement,
    private readonly clock: () => number = () => performance.now(),
    private readonly lifeMs = 2500,
    private readonly most = 4,
  ) {
    parent.appendChild(this.root);
  }

  show(caption: Caption): void {
    const now = this.clock();
    const where = caption.bearing
      ? ` ${ARROW[caption.bearing]}${caption.metres ? ` ${caption.metres} m` : ''}`
      : '';
    const el = h('div', { class: 'hud-caption', text: `[${caption.text}]${where}` });
    this.lines.push({ el, until: now + this.lifeMs });
    this.root.appendChild(el);
    while (this.lines.length > this.most) this.lines.shift()?.el.remove();
  }

  /** Takes away lines whose time is up; call now and then. */
  tick(): void {
    const now = this.clock();
    while (this.lines.length > 0 && (this.lines[0] as { until: number }).until <= now)
      this.lines.shift()?.el.remove();
  }

  clear(): void {
    this.lines.length = 0;
    clear(this.root);
  }
}
