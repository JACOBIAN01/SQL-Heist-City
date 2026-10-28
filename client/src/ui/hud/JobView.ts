import { theme } from '../../theme/theme';
import type { JobMessage } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { h } from '../dom';
import './hud.css';

/**
 * The side job in progress (Phase 30.6): what to do, how far along and the time left. The server
 * owns the clock and the route; this counts down locally between its messages.
 */
export class JobView {
  readonly root = h('div', {
    class: 'job-hud',
    attrs: { 'data-role': 'job', role: 'status', hidden: '' },
  });
  private message: JobMessage | undefined;
  private receivedAt = 0;
  private hideAt = 0;

  constructor(private readonly i18n: I18n) {
    i18n.onChange(() => this.draw(performance.now()));
  }

  update(message: JobMessage, now: number): void {
    this.message = message;
    this.receivedAt = now;
    // The end of a job stays on screen a few seconds.
    this.hideAt = message.status === 'done' || message.status === 'failed' ? now + 4000 : Infinity;
    this.draw(now);
  }

  /** Call every frame (cheap): keeps the clock moving and hides the box when it is over. */
  frame(now: number): void {
    if (!this.message) return;
    if (now >= this.hideAt) {
      this.message = undefined;
      this.root.hidden = true;
      return;
    }
    this.draw(now);
  }

  private t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  private draw(now: number): void {
    const m = this.message;
    this.root.hidden = !m || m.status === 'none';
    if (!m || m.status === 'none') return;
    const money = m.reward.toLocaleString('en-US');
    if (m.status === 'done')
      this.root.textContent = theme.text(this.t('job.done', { reward: money }));
    else if (m.status === 'failed') this.root.textContent = this.t('job.failed');
    else if (m.status === 'claim') this.root.textContent = this.t('job.claim');
    else {
      const left = Math.max(0, Math.ceil(m.secondsLeft - (now - this.receivedAt) / 1000));
      const params = {
        n: m.index + 1,
        total: m.targets.length,
        pct: Math.round((m.dwell ?? 0) * 100),
      };
      const what = this.t(`job.${m.kind}` as MessageKey, params);
      this.root.textContent = theme.text(
        `${what} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · $${money}`,
      );
    }
  }
}
