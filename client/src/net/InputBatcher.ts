import { MAX_COMMANDS_PER_MESSAGE, type InputCommand } from '@heist/shared';

/**
 * Collects the 60 Hz commands and sends them in batches (~30 per second)
 * instead of one tiny message per tick: fewer frames, same latency budget.
 */
export class InputBatcher {
  private buffer: InputCommand[] = [];
  private lastFlush = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly send: (commands: readonly InputCommand[]) => void,
    private readonly intervalMs = 33,
  ) {}

  push(command: InputCommand): void {
    this.buffer.push(command);
  }

  /** Sends what is waiting if the interval has passed (or the buffer is nearly a full message). */
  flush(nowMs: number): void {
    if (this.buffer.length === 0) return;
    const due = nowMs - this.lastFlush >= this.intervalMs;
    if (!due && this.buffer.length < MAX_COMMANDS_PER_MESSAGE) return;
    this.lastFlush = nowMs;
    while (this.buffer.length > 0) {
      this.send(this.buffer.splice(0, MAX_COMMANDS_PER_MESSAGE));
    }
  }
}
