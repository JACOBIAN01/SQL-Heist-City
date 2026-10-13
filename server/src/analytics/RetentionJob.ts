import type { AnalyticsSettings } from '@heist/shared';
import type { AttemptStore } from './AttemptStore';

const DAY_MS = 86_400_000;

/**
 * Prunes the learning record on a schedule (docs/privacy.md, Phase 21): raw
 * events after `rawEventDays`, finished items after `itemDays`. The profile
 * totals are additive and kept, so a student's profile survives the pruning.
 */
export class RetentionJob {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly store: AttemptStore,
    private readonly settings: () => AnalyticsSettings,
    private readonly now: () => number = Date.now,
    private readonly log: (message: string) => void = () => {},
  ) {}

  /** One pass: delete what is past its time. 0 days means keep forever. */
  async run(): Promise<{ events: number; items: number }> {
    const s = this.settings();
    const now = this.now();
    const result = await this.store.prune({
      ...(s.rawEventDays > 0 ? { events: now - s.rawEventDays * DAY_MS } : {}),
      ...(s.itemDays > 0 ? { items: now - s.itemDays * DAY_MS } : {}),
    });
    if (result.events + result.items > 0)
      this.log(`retention: removed ${result.events} events and ${result.items} items`);
    return result;
  }

  /** Runs now and then every `everyMs` (a day). The timer never keeps the process alive. */
  start(everyMs = DAY_MS, onError: (err: unknown) => void = () => {}): void {
    const tick = () => void this.run().catch(onError);
    tick();
    this.timer = setInterval(tick, everyMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
