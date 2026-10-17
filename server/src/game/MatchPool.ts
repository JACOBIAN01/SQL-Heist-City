import { log } from '../log';
import { Worker } from 'node:worker_threads';
import type { HeistSettings, MatchSettings } from '@heist/shared';
import type { RoundResult } from '../heist/HeistEvents';
import type { ClassMatchConfig } from '../classes/ClassMatchConfig';
import type { MapName } from './maps';
import type { MatchWorkerData, MatchWorkerMessage } from './matchWorker';

// Running from TypeScript source (dev/tests) the worker needs the tsx loader;
// a production build would point at compiled .js and need nothing.
const fromSource = import.meta.url.endsWith('.ts');
const workerUrl = new URL(fromSource ? './matchWorker.ts' : './matchWorker.js', import.meta.url);
const workerExecArgv = fromSource ? ['--import', 'tsx'] : [];

type Metrics = Extract<MatchWorkerMessage, { type: 'metrics' }>['metrics'];

/** Optional wiring for a match thread. */
export interface MatchExtras {
  readonly heist?: HeistSettings;
  /** Question database (opened read-only inside the thread) so the match can serve SQL tasks. */
  readonly dbPath?: string;
  readonly ticketSecret?: string;
  readonly requireTicket?: boolean;
  /** The class this match is a room for. */
  readonly classConfig?: ClassMatchConfig;
  readonly databaseUrl?: string;
}

/** What a teacher can tell a running class room to do. */
export type ClassCommand =
  | { readonly type: 'class_config'; readonly config: ClassMatchConfig }
  | { readonly type: 'end_round' }
  | { readonly type: 'next_round' }
  | { readonly type: 'kick'; readonly accountId: number }
  | { readonly type: 'rename'; readonly accountId: number; readonly name: string };

export interface MatchInfo {
  /** Set for a class room. */
  readonly classId?: number;
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
    readonly classId?: number,
  ) {}

  get info(): MatchInfo {
    return {
      id: this.id,
      port: this.port,
      players: this.latest?.players ?? 0,
      maxPlayers: this.maxPlayers,
      ...(this.classId === undefined ? {} : { classId: this.classId }),
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

  /** `onRoundResult`: told whenever a class room's round ends (to be recorded). */
  constructor(private readonly onRoundResult?: (classId: number, result: RoundResult) => void) {}

  /** Starts a match in a new thread and resolves when it is listening. */
  start(
    settings: MatchSettings,
    port = 0,
    map?: MapName,
    extras: MatchExtras = {},
  ): Promise<MatchInfo> {
    const id = this.nextId++;
    const data: MatchWorkerData = {
      matchId: id,
      port,
      settings,
      ...(map ? { map } : {}),
      ...(extras.heist ? { heist: extras.heist } : {}),
      ...(extras.dbPath ? { dbPath: extras.dbPath } : {}),
      ...(extras.ticketSecret ? { ticketSecret: extras.ticketSecret } : {}),
      ...(extras.requireTicket ? { requireTicket: true } : {}),
      ...(extras.classConfig ? { classConfig: extras.classConfig } : {}),
      ...(extras.databaseUrl ? { databaseUrl: extras.databaseUrl } : {}),
    };
    const worker = new Worker(workerUrl, { execArgv: workerExecArgv, workerData: data });
    return new Promise((resolve, reject) => {
      worker.once('error', reject);
      worker.on('message', (message: MatchWorkerMessage) => {
        if (message.type === 'ready') {
          const cap = extras.classConfig
            ? Math.min(settings.maxPlayers, extras.classConfig.playerCap)
            : settings.maxPlayers;
          const match = new RunningMatch(
            id,
            message.port,
            cap,
            worker,
            extras.classConfig?.classId,
          );
          this.matches.set(id, match);
          worker.on('exit', () => {
            this.matches.delete(id);
            if (!this.stopping) log.warn('match stopped unexpectedly', { match: id });
          });
          resolve(match.info);
        } else if (message.type === 'round_result') {
          this.onRoundResult?.(message.classId, message.result);
        } else {
          const match = this.matches.get(id);
          if (match) match.latest = message.metrics;
        }
      });
    });
  }

  /** Admin edited questions or settings: every match thread drops its caches. */
  reload(): void {
    for (const m of this.matches.values()) m.worker.postMessage({ type: 'reload' });
  }

  list(): MatchInfo[] {
    return [...this.matches.values()].map((m) => m.info);
  }

  /** The room running for a class, if any. */
  classRoom(classId: number): MatchInfo | undefined {
    return this.list().find((m) => m.classId === classId);
  }

  /** Tells a class room what its teacher did. Returns false when the room is not running. */
  commandClass(classId: number, command: ClassCommand): boolean {
    const room = [...this.matches.values()].find((m) => m.classId === classId);
    if (!room) return false;
    room.worker.postMessage(command);
    return true;
  }

  /** Shuts one class room down (everyone is disconnected). */
  async stopClass(classId: number): Promise<boolean> {
    const room = [...this.matches.values()].find((m) => m.classId === classId);
    if (!room) return false;
    await new Promise<void>((resolve) => {
      room.worker.once('exit', () => resolve());
      room.worker.postMessage({ type: 'stop' });
    });
    return true;
  }

  /** First match with room, for the lobby to send a new player to. */
  openMatch(): MatchInfo | undefined {
    return this.list().find((m) => m.classId === undefined && m.players < m.maxPlayers);
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
