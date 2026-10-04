import { Worker } from 'node:worker_threads';
import type { HeistSettings, MatchSettings } from '@heist/shared';
import type { MapName } from './maps';
import type { MatchWorkerData, MatchWorkerMessage } from './matchWorker';

// Running from TypeScript source (dev/tests) the worker needs the tsx loader;
// a production build would point at compiled .js and need nothing.
const fromSource = import.meta.url.endsWith('.ts');
const workerUrl = new URL(fromSource ? './matchWorker.ts' : './matchWorker.js', import.meta.url);
const workerExecArgv = fromSource ? ['--import', 'tsx'] : [];

type Metrics = Extract<MatchWorkerMessage, { type: 'metrics' }>['metrics'];

export interface MatchInfo {
  readonly id: number;
  readonly port: number;
  readonly players: number;
  readonly maxPlayers: number;
}

class RunningMatch {
  latest: Metrics | undefined;

  constructor(
    readonly id: number,
    readonly port: number,
    readonly maxPlayers: number,
    readonly worker: Worker,
  ) {}

  get info(): MatchInfo {
    return {
      id: this.id,
      port: this.port,
      players: this.latest?.players ?? 0,
      maxPlayers: this.maxPlayers,
    };
  }
}

/**
 * Runs each match in its own worker thread (docs/backend.md process model) and
 * keeps the lobby view: which matches exist, where, and how full.
 * Pattern: Object Pool-style registry — Why: starting a match is a heavy,
 * isolated unit of work; the pool owns lifecycle (start, stop, replace on
 * crash) so callers only ask "give me a match with room".
 */
export class MatchPool {
  private readonly matches = new Map<number, RunningMatch>();
  private nextId = 1;
  private stopping = false;

  /** Starts a match in a new thread and resolves when it is listening. */
  start(
    settings: MatchSettings,
    port = 0,
    map?: MapName,
    heist?: HeistSettings,
  ): Promise<MatchInfo> {
    const id = this.nextId++;
    const data: MatchWorkerData = {
      matchId: id,
      port,
      settings,
      ...(map ? { map } : {}),
      ...(heist ? { heist } : {}),
    };
    const worker = new Worker(workerUrl, { execArgv: workerExecArgv, workerData: data });
    return new Promise((resolve, reject) => {
      worker.once('error', reject);
      worker.on('message', (message: MatchWorkerMessage) => {
        if (message.type === 'ready') {
          const match = new RunningMatch(id, message.port, settings.maxPlayers, worker);
          this.matches.set(id, match);
          worker.on('exit', () => {
            this.matches.delete(id);
            if (!this.stopping) console.warn(`match ${id} stopped unexpectedly`);
          });
          resolve(match.info);
        } else {
          const match = this.matches.get(id);
          if (match) match.latest = message.metrics;
        }
      });
    });
  }

  list(): MatchInfo[] {
    return [...this.matches.values()].map((m) => m.info);
  }

  /** First match with room, for the lobby to send a new player to. */
  openMatch(): MatchInfo | undefined {
    return this.list().find((m) => m.players < m.maxPlayers);
  }

  /** Latest per-match numbers, for `/metrics`. */
  metrics(): Record<number, Metrics | undefined> {
    return Object.fromEntries([...this.matches.entries()].map(([id, m]) => [id, m.latest]));
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await Promise.all(
      [...this.matches.values()].map(
        (m) =>
          new Promise<void>((resolve) => {
            m.worker.once('exit', () => resolve());
            m.worker.postMessage({ type: 'stop' });
          }),
      ),
    );
  }
}
