import { fork } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { JobOutcome, SandboxJob, SandboxRunner } from './SandboxRunner';

export interface WorkerSandboxRunnerOptions {
  /** Worker threads in the pool. Default: cores − 1 (min 1). */
  size?: number;
  /** Wall-clock budget per job; the worker is killed after this. Default 2000 ms. */
  timeoutMs?: number;
  /**
   * `process` (default): each slot is a child process, killed outright on a timeout. `thread`:
   * a worker thread, cheaper to start, but a thread stuck inside SQLite cannot be stopped (it
   * keeps a CPU busy and the process cannot exit), so it is for trusted SQL only (Phase 18.4).
   */
  isolation?: 'process' | 'thread';
  /**
   * A job's first budget (ms). Past it the job is stopped and run again in the slow lane, which
   * may use at most half the slots, with the rest of `timeoutMs` (Phase 19.3). So a few runaway
   * queries never make ordinary answers wait long. 0 turns the lanes off. Default 150.
   */
  fastBudgetMs?: number;
  /** Started, idle processes kept to replace a killed one at once (a fresh one takes a while to load). Default 2. */
  spares?: number;
}

/** One place a job runs: a thread or a child process. */
interface Isolate {
  post(message: { id: number; job: SandboxJob }): void;
  onMessage(listener: (msg: { id: number; outcome: JobOutcome }) => void): void;
  /** Called once it can take a job (a process has loaded its code). */
  onReady(listener: () => void): void;
  onFail(listener: (message: string) => void): void;
  /** Stops it now and forgets its listeners. */
  kill(): Promise<void>;
}

interface Task {
  id: number;
  job: SandboxJob;
  resolve: (outcome: JobOutcome) => void;
  /** When it was queued (ms), for the queue-wait statistics. */
  queuedAt: number;
  /** `slow` once it overran its first budget. */
  lane: 'fast' | 'slow';
}

/** How busy the grader is, for `/metrics` and the stress test (Phase 19.2). */
export interface SandboxStats {
  readonly slots: number;
  readonly busy: number;
  readonly queued: number;
  readonly jobs: number;
  readonly timeouts: number;
  /** Jobs moved to the slow lane for overrunning their first budget. */
  readonly demoted: number;
  /** Time jobs waited for a free slot, over the last 500 jobs (ms). */
  readonly waitMs: { readonly p50: number; readonly p95: number; readonly max: number };
}

interface Slot {
  worker: Isolate;
  task: Task | null;
  timer: NodeJS.Timeout | null;
  /** Jobs go only to ready slots, so start-up time never counts against a job's time limit. */
  ready: boolean;
}

// Running from TypeScript source (dev/tests) the worker needs the tsx loader;
// a production build would point at compiled .js and need nothing.
const fromSource = import.meta.url.endsWith('.ts');
const workerUrl = new URL(
  fromSource ? './sandbox.worker.ts' : './sandbox.worker.js',
  import.meta.url,
);
const workerExecArgv = fromSource ? ['--import', 'tsx'] : [];
const processUrl = new URL(
  fromSource ? './sandbox.process.ts' : './sandbox.process.js',
  import.meta.url,
);

// Pattern: Object Pool — Why: starting a worker costs ~tens of ms; reusing a
// fixed set keeps grading latency low and caps concurrency, while a runaway
// query only ever kills (and replaces) its own worker.
export class WorkerSandboxRunner implements SandboxRunner {
  private readonly slots: Slot[] = [];
  private readonly queue: Task[] = [];
  private readonly slowQueue: Task[] = [];
  private readonly timeoutMs: number;
  private readonly fastBudgetMs: number;
  private readonly slowSlots: number;
  private demoted = 0;
  private readonly spares: { isolate: Isolate; ready: boolean }[] = [];
  private readonly spareCount: number;
  private readonly isolation: 'process' | 'thread';
  private nextId = 1;
  private readonly waits: number[] = [];
  private jobs = 0;
  private timeouts = 0;
  /** Held while jobs wait for a slot (idle sandboxes do not keep the process alive, waiting jobs do). */
  private keepAlive: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(options: WorkerSandboxRunnerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 2_000;
    this.isolation = options.isolation ?? 'process';
    const size = options.size ?? Math.max(1, availableParallelism() - 1);
    const budget = options.fastBudgetMs ?? 150;
    // Lanes need at least two slots and a first budget shorter than the whole limit.
    this.fastBudgetMs = size > 1 && budget > 0 && budget < this.timeoutMs ? budget : 0;
    this.slowSlots = Math.max(1, Math.floor(size / 2));
    for (let i = 0; i < size; i++) this.slots.push(this.spawn());
    this.spareCount = this.isolation === 'process' ? (options.spares ?? 2) : 0;
    for (let i = 0; i < this.spareCount; i++) this.addSpare();
  }

  run(job: SandboxJob): Promise<JobOutcome> {
    if (this.closed) return Promise.reject(new Error('sandbox runner is closed'));
    return new Promise((resolve) => {
      this.queue.push({ id: this.nextId++, job, resolve, queuedAt: Date.now(), lane: 'fast' });
      this.keepAlive ??= setInterval(() => {}, 60_000);
      this.dispatch();
    });
  }

  stats(): SandboxStats {
    const sorted = [...this.waits].sort((a, b) => a - b);
    const at = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    return {
      slots: this.slots.length,
      busy: this.slots.filter((s) => s.task).length,
      queued: this.queue.length + this.slowQueue.length,
      jobs: this.jobs,
      timeouts: this.timeouts,
      demoted: this.demoted,
      waitMs: { p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? 0 },
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.release();
    const closedOutcome: JobOutcome = {
      ok: false,
      code: 'crashed',
      message: 'sandbox runner closed',
    };
    for (const task of [...this.queue.splice(0), ...this.slowQueue.splice(0)])
      task.resolve(closedOutcome);
    await Promise.all(this.spares.splice(0).map((s) => s.isolate.kill()));
    await Promise.all(
      this.slots.map((slot) => {
        this.settle(slot, closedOutcome);
        return slot.worker.kill();
      }),
    );
  }

  private addSpare(): void {
    const spare = { isolate: this.createIsolate(), ready: false };
    spare.isolate.onReady(() => (spare.ready = true));
    spare.isolate.onFail(() => {
      const i = this.spares.indexOf(spare);
      if (i >= 0) this.spares.splice(i, 1);
    });
    this.spares.push(spare);
  }

  private spawn(): Slot {
    const slot: Slot = { worker: this.createIsolate(), task: null, timer: null, ready: false };
    this.listen(slot);
    return slot;
  }

  private listen(slot: Slot): void {
    const worker = slot.worker;
    worker.onReady(() => {
      if (slot.worker !== worker) return;
      slot.ready = true;
      this.dispatch();
    });
    worker.onMessage((msg) => {
      if (slot.worker === worker && slot.task?.id === msg.id) {
        this.settle(slot, msg.outcome);
        this.dispatch();
      }
    });
    worker.onFail((message) => {
      if (slot.worker === worker) this.replace(slot, { ok: false, code: 'crashed', message });
    });
  }

  private dispatch(): void {
    if (this.closed) return this.release();
    for (const slot of this.slots) {
      if (!slot.ready || slot.task) continue;
      const slowBusy = this.slots.filter((s) => s.task?.lane === 'slow').length;
      const task =
        this.queue.shift() ?? (slowBusy < this.slowSlots ? this.slowQueue.shift() : undefined);
      if (!task) break;
      slot.task = task;
      if (task.lane === 'fast') {
        this.jobs++;
        this.waits.push(Date.now() - task.queuedAt);
        if (this.waits.length > 500) this.waits.shift();
      }
      const lanes = this.fastBudgetMs > 0;
      const budget = !lanes
        ? this.timeoutMs
        : task.lane === 'fast'
          ? this.fastBudgetMs
          : this.timeoutMs - this.fastBudgetMs;
      slot.timer = setTimeout(() => {
        if (lanes && task.lane === 'fast') {
          // Overran its first budget: run it again in the slow lane, out of everyone's way.
          this.demoted++;
          slot.task = null;
          this.slowQueue.push({ ...task, lane: 'slow' });
          this.replace(slot, null);
          return;
        }
        this.timeouts++;
        this.replace(slot, {
          ok: false,
          code: 'timeout',
          message: `query took longer than ${this.timeoutMs} ms`,
        });
      }, budget);
      slot.worker.post({ id: task.id, job: task.job });
    }
    if (this.queue.length === 0 && this.slowQueue.length === 0) this.release();
  }

  private release(): void {
    clearInterval(this.keepAlive);
    this.keepAlive = undefined;
  }

  private settle(slot: Slot, outcome: JobOutcome): void {
    const task = slot.task;
    slot.task = null;
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    task?.resolve(outcome);
  }

  /** Kills the slot's worker (stuck or crashed) and swaps in a fresh one synchronously. */
  private replace(slot: Slot, outcome: JobOutcome | null): void {
    if (outcome) this.settle(slot, outcome);
    else if (slot.timer) {
      clearTimeout(slot.timer);
      slot.timer = null;
    }
    const old = slot.worker;
    void old.kill();
    if (this.closed) return;
    // A ready spare takes over at once; a new spare starts loading in the background.
    const spare = this.spares.shift();
    slot.worker = spare?.isolate ?? this.createIsolate();
    slot.ready = spare?.ready ?? false;
    this.listen(slot);
    if (spare) this.addSpare();
    this.dispatch();
  }

  private createIsolate(): Isolate {
    return this.isolation === 'process' ? createProcess() : threadIsolate(createWorker());
  }
}

function createProcess(): Isolate {
  const child = fork(processUrl, [], {
    execArgv: [...workerExecArgv, '--max-old-space-size=64', '--stack-size=4000'],
    // Structured clone, so the tables (a Map) cross as they are.
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  // Idle sandboxes must not keep the process alive.
  child.unref();
  child.channel?.unref();
  return {
    post: (message) => {
      child.channel?.ref();
      child.send(message);
    },
    onMessage: (listener) =>
      child.on('message', (msg: { id: number; outcome: JobOutcome } | { ready: true }) => {
        if ('ready' in msg) return;
        child.channel?.unref();
        listener(msg);
      }),
    onReady: (listener) =>
      child.on('message', (msg: object) => {
        if ('ready' in msg) listener();
      }),
    onFail: (listener) => {
      child.on('error', (err) => listener(err.message));
      child.on('exit', () => listener('sandbox process exited'));
    },
    kill: async () => {
      child.removeAllListeners();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    },
  };
}

function threadIsolate(worker: Worker): Isolate {
  return {
    post: (message) => worker.postMessage(message),
    onMessage: (listener) => worker.on('message', listener),
    // A thread queues messages until its code has loaded.
    onReady: (listener) => queueMicrotask(listener),
    onFail: (listener) => {
      worker.on('error', (err) => listener(err.message));
      worker.on('exit', () => listener('worker exited'));
    },
    kill: async () => {
      worker.removeAllListeners();
      await worker.terminate();
    },
  };
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
