import type { BankingMessage } from '@heist/shared';
import type { HudView } from '../ui/hud/Hud';
import { formatMoney } from '../ui/hud/Hud';

const CANCEL_TEXT = {
  hurt: 'Banking interrupted: you were hit',
  moved: 'Banking cancelled: you left the safehouse',
  died: 'Banking cancelled',
} as const;

/** Shows a progress bar while the server counts down a banking channel, and the outcome after. */
export class BankingProgress {
  private startedAt = 0;
  private durationMs = 0;
  private active = false;

  constructor(private readonly hud: HudView) {}

  /** `nowMs` is the local clock; the server only says how long it takes, not when it started. */
  handle(message: BankingMessage, nowMs: number): void {
    if (message.status === 'started') {
      this.active = true;
      this.startedAt = nowMs;
      this.durationMs = message.seconds * 1000;
      this.update(nowMs);
      return;
    }
    this.active = false;
    this.hud.setProgress(undefined);
    this.hud.toast(
      message.status === 'done'
        ? `Banked ${formatMoney(message.amount)}`
        : CANCEL_TEXT[message.reason],
    );
  }

  /** Call every frame while the game runs. */
  update(nowMs: number): void {
    if (!this.active) return;
    this.hud.setProgress({
      label: 'Banking…',
      fraction: this.durationMs > 0 ? (nowMs - this.startedAt) / this.durationMs : 1,
    });
  }
}
