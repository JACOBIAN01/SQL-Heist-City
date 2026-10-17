import { scrubErrorText, type ClientError } from '@heist/shared';

export interface ErrorReporterOptions {
  /** Delivers one report; failures are ignored (reporting must never cause an error). */
  readonly send: (report: ClientError) => void;
  /** The page path and agent the report names. */
  readonly page: () => string;
  readonly userAgent?: string;
  /** Reports per page load (a loop that throws every frame must not flood). Default 5. */
  readonly maxPerLoad?: number;
  /** Minimum gap between reports (ms). Default 1000. */
  readonly minGapMs?: number;
  readonly now?: () => number;
}

/**
 * Sends the errors a student's browser hits to the game server's log (Phase 20.5), so a broken
 * page is seen by the people who can fix it. It sends the message, a short stack, the page path
 * and the browser; never a name, account, ticket or query string. The same error is sent once.
 */
export class ErrorReporter {
  private readonly seen = new Set<string>();
  private sent = 0;
  private last = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: ErrorReporterOptions) {}

  /** Starts listening to the window's error events. */
  install(target: Pick<Window, 'addEventListener'>): void {
    target.addEventListener('error', (e) => {
      const event = e as ErrorEvent;
      // Resource load failures (an image) arrive here with no error object: not a script error.
      if (!event.error && !event.message) return;
      this.report('error', event.error ?? event.message);
    });
    target.addEventListener('unhandledrejection', (e) => {
      this.report('unhandledrejection', (e as PromiseRejectionEvent).reason);
    });
  }

  report(source: ClientError['source'], error: unknown): void {
    const now = (this.options.now ?? Date.now)();
    const message = scrubErrorText(textOf(error)).slice(0, 500);
    const stack =
      error instanceof Error && error.stack
        ? scrubErrorText(error.stack).split('\n').slice(0, 8).join('\n').slice(0, 2000)
        : undefined;
    const key = `${source}|${message}|${stack?.split('\n')[1] ?? ''}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.sent >= (this.options.maxPerLoad ?? 5)) return;
    if (now - this.last < (this.options.minGapMs ?? 1000)) return;
    this.sent++;
    this.last = now;
    try {
      this.options.send({
        message,
        source,
        page: this.options.page().slice(0, 100),
        ...(stack ? { stack } : {}),
        ...(this.options.userAgent ? { userAgent: this.options.userAgent.slice(0, 300) } : {}),
      });
    } catch {
      // never let reporting itself throw
    }
  }
}

function textOf(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** The beacon: a small POST the page can fire while it is closing. `text/plain` skips the preflight request. */
export function postReport(base: string): (report: ClientError) => void {
  return (report) => {
    void fetch(`${base}/client-error`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(report),
      keepalive: true,
    }).catch(() => undefined);
  };
}
