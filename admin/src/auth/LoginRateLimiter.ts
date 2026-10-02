/**
 * Slows down password guessing: after `maxFailures` failed logins for the
 * same key (email + IP) within `windowMs`, further attempts are refused until
 * the window passes. A successful login clears the key.
 */
export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Epoch ms when the key may try again, or undefined if allowed now. */
  blockedUntil(key: string): number | undefined {
    const recent = this.recent(key);
    if (recent.length < this.maxFailures) return undefined;
    return (recent[0] as number) + this.windowMs;
  }

  recordFailure(key: string): void {
    this.failures.set(key, [...this.recent(key), this.now()]);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const recent = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length === 0) this.failures.delete(key);
    else this.failures.set(key, recent);
    return recent;
  }
}
