import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { JobOutcome, SandboxJob, SandboxRunner } from './SandboxRunner';

export interface WorkerSandboxRunnerOptions {
  /** Worker threads in the pool. Default: cores − 1 (min 1). */
  size?: number;
  /** Wall-clock budget per job; the worker is killed after this. Default 2000 ms. */
  timeoutMs?: number;
}

interface Task {
  id: number;
  job: SandboxJob;
  resolve: (outcome: JobOutcome) => void;
}

interface Slot {
  worker: Worker;
  task: Task | null;
  timer: NodeJS.Timeout | null;
}

// Running from TypeScript source (dev/tests) the worker needs the tsx loader;
// a production build would point at compiled .js and need nothing.
const fromSource = import.meta.url.endsWith('.ts');
const workerUrl = new URL(
  fromSource ? './sandbox.worker.ts' : './sandbox.worker.js',
  import.meta.url,
);
const workerExecArgv = fromSource ? ['--import', 'tsx'] : [];

// Pattern: Object Pool — Why: starting a worker costs ~tens of ms; reusing a
// fixed set keeps grading latency low and caps concurrency, while a runaway
// query only ever kills (and replaces) its own worker.
export class WorkerSandboxRunner implements SandboxRunner {
  private readonly slots: Slot[] = [];
  private readonly queue: Task[] = [];
  private readonly timeoutMs: number;
  private nextId = 1;
  private closed = false;

  constructor(options: WorkerSandboxRunnerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 2_000;
    const size = options.size ?? Math.max(1, availableParallelism() - 1);
    for (let i = 0; i < size; i++) this.slots.push(this.spawn());
  }

  run(job: SandboxJob): Promise<JobOutcome> {
    if (this.closed) return Promise.reject(new Error('sandbox runner is closed'));
    return new Promise((resolve) => {
      this.queue.push({ id: this.nextId++, job, resolve });
      this.dispatch();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const closedOutcome: JobOutcome = {
      ok: false,
      code: 'crashed',
      message: 'sandbox runner closed',
    };
    for (const task of this.queue.splice(0)) task.resolve(closedOutcome);
    await Promise.all(
      this.slots.map((slot) => {
        this.settle(slot, closedOutcome);
        slot.worker.removeAllListeners();
        return slot.worker.terminate();
      }),
    );
  }

  private spawn(): Slot {
    const slot: Slot = { worker: createWorker(), task: null, timer: null };
    this.listen(slot);
    return slot;
  }

  private listen(slot: Slot): void {
    const worker = slot.worker;
    worker.on('message', (msg: { id: number; outcome: JobOutcome }) => {
      if (slot.worker === worker && slot.task?.id === msg.id) {
        this.settle(slot, msg.outcome);
        this.dispatch();
      }
    });
    const fail = (message: string) => {
      if (slot.worker === worker) this.replace(slot, { ok: false, code: 'crashed', message });
    };
    worker.on('error', (err) => fail(err.message));
    worker.on('exit', () => fail('worker exited'));
  }

  private dispatch(): void {
    if (this.closed) return;
    for (const slot of this.slots) {
      if (slot.task || this.queue.length === 0) continue;
      const task = this.queue.shift() as Task;
      slot.task = task;
      slot.timer = setTimeout(() => {
        this.replace(slot, {
          ok: false,
          code: 'timeout',
          message: `query took longer than ${this.timeoutMs} ms`,
        });
      }, this.timeoutMs);
      slot.worker.postMessage({ id: task.id, job: task.job });
    }
  }

  private settle(slot: Slot, outcome: JobOutcome): void {
    const task = slot.task;
    slot.task = null;
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    task?.resolve(outcome);
  }

  /** Kills the slot's worker (stuck or crashed) and swaps in a fresh one synchronously. */
  private replace(slot: Slot, outcome: JobOutcome): void {
    this.settle(slot, outcome);
    const old = slot.worker;
    old.removeAllListeners();
    void old.terminate();
    if (this.closed) return;
    slot.worker = createWorker();
    this.listen(slot);
    this.dispatch();
  }
}

function createWorker(): Worker {
  const worker = new Worker(workerUrl, {
    execArgv: workerExecArgv,
    // Caps the worker's JS heap; SQLite's own allocations are capped by the
    // sandbox's length limits and the row cap.
    resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
  });
  // Idle workers must not keep the process alive.
  worker.unref();
  return worker;
}
