import type { AdminEventBus } from '../events/AdminEvents';

export interface ReloadNotifierOptions {
  /** Game server base URL, e.g. http://localhost:8080. */
  readonly gameServerUrl: string;
  readonly secret: string;
  /** Collapse bursts (bulk import) into one reload. */
  readonly debounceMs?: number;
  readonly logger: { warn(message: string, meta?: Record<string, unknown>): void };
}

/**
 * Tells the game server to drop its caches after any admin change, so edits
 * reach the next challenge without a restart. Failures are logged, never
 * thrown: an unreachable game server must not block a teacher's save.
 */
export class ReloadNotifier {
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(private readonly options: ReloadNotifierOptions) {}

  /** Subscribes to every admin event. Returns the unsubscribe function. */
  attach(bus: AdminEventBus): () => void {
    return bus.subscribe(() => this.schedule());
  }

  schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.inFlight = this.send();
    }, this.options.debounceMs ?? 100);
  }

  /** For tests and shutdown: wait for a scheduled/in-flight reload. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.inFlight = this.send();
    }
    await this.inFlight;
  }

  private async send(): Promise<void> {
    this.timer = undefined;
    try {
      const res = await fetch(new URL('/internal/reload', this.options.gameServerUrl), {
        method: 'POST',
        headers: { 'x-internal-secret': this.options.secret },
        signal: AbortSignal.timeout(2_000),
      });
      if (!res.ok) this.options.logger.warn('game server rejected reload', { status: res.status });
    } catch (err) {
      this.options.logger.warn('could not reach game server for reload', {
        error: (err as Error).message,
      });
    }
  }
}
