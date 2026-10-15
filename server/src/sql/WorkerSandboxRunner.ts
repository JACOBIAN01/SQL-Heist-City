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
  private readonly timeoutMs: number;
  private readonly isolation: 'process' | 'thread';
  private nextId = 1;
  private closed = false;

  constructor(options: WorkerSandboxRunnerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 2_000;
    this.isolation = options.isolation ?? 'process';
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
        return slot.worker.kill();
      }),
    );
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
    if (this.closed) return;
    for (const slot of this.slots) {
      if (!slot.ready || slot.task || this.queue.length === 0) continue;
      const task = this.queue.shift() as Task;
      slot.task = task;
      slot.timer = setTimeout(() => {
        this.replace(slot, {
          ok: false,
          code: 'timeout',
          message: `query took longer than ${this.timeoutMs} ms`,
        });
      }, this.timeoutMs);
      slot.worker.post({ id: task.id, job: task.job });
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
    void old.kill();
    if (this.closed) return;
    slot.worker = this.createIsolate();
    slot.ready = false;
    this.listen(slot);
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
