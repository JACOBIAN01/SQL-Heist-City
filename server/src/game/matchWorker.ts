import { createServer } from 'node:http';
import { parentPort, workerData } from 'node:worker_threads';
import { DEFAULT_ANALYTICS_SETTINGS, type HeistSettings, type MatchSettings } from '@heist/shared';
import { existsSync } from 'node:fs';
import { AnalyticsKit } from '../analytics/AnalyticsKit';
import { buildChallengeStack, type ChallengeStack } from '../composition';
import { PgDatabase } from '../pg/PgDatabase';
import { openDatabase } from '../db/database';
import { mapByName, type MapName } from './maps';
import type { ClassMatchConfig } from '../classes/ClassMatchConfig';
import type { RoundResult } from '../heist/HeistEvents';
import type { ClassCommand } from './MatchPool';
import type { Match } from './Match';
import { ticketAuth } from './GameAuth';
import { startGame } from './startGame';

/** What the pool hands each worker at startup. */
export interface MatchWorkerData {
  readonly matchId: number;
  /** TCP port to listen on; 0 picks a free one (it is reported back). */
  readonly port: number;
  readonly settings: MatchSettings;
  /** Which map to load (default: the sandbox yard). */
  readonly map?: MapName;
  readonly heist?: HeistSettings;
  /** Question database; the thread opens it read-only and serves SQL tasks from it. */
  readonly dbPath?: string;
  /** Sign-in: tickets signed with this secret (set by the pool; workers cannot be handed objects). */
  readonly ticketSecret?: string;
  readonly requireTicket?: boolean;
  readonly classConfig?: ClassMatchConfig;
  /** PostgreSQL, for the learning record (attempts and live profiles). */
  readonly databaseUrl?: string;
}

/** Messages worker → pool. */
export type MatchWorkerMessage =
  | { readonly type: 'ready'; readonly port: number }
  | {
      readonly type: 'metrics';
      readonly metrics: ReturnType<ReturnType<typeof startGame>['metrics']>;
    }
  /** A class room's round finished. */
  | { readonly type: 'round_result'; readonly classId: number; readonly result: RoundResult };

/**
 * One match, one thread: this file is the thread's entry point. It owns its own
 * HTTP + WebSocket listener, so a client connects straight to it and the match's
 * 20 Hz loop never competes with other matches (or the main process) for the
 * same event loop. The main process only keeps a lobby listing.
 */
const data = workerData as MatchWorkerData;
const http = createServer();
// Each thread has its own read-only handle and challenge stack: SQLite allows many readers, and
// a match then never waits on another thread to ask or grade a question.
// The analytics settings come from the stack, which needs the analytics sink first: a holder breaks the loop.
const holder: { stack?: ChallengeStack | undefined } = {};
// The learning record: every attempt is saved and each student's profile kept live (Phase 15).
const analytics = data.databaseUrl
  ? new AnalyticsKit(
      PgDatabase.open({ url: data.databaseUrl, max: 2 }),
      () => holder.stack?.analyticsSettings() ?? DEFAULT_ANALYTICS_SETTINGS,
    )
  : undefined;
const stack: ChallengeStack | undefined =
  data.dbPath && existsSync(data.dbPath)
    ? buildChallengeStack(openDatabase({ path: data.dbPath, readOnly: true }), {
        logger: { warn: (message, meta) => console.warn(message, meta ?? '') },
        ...(analytics ? { attempts: analytics.sink } : {}),
      })
    : undefined;
holder.stack = stack;
const heist = data.heist ?? stack?.heistSettings();
const game = startGame(http, data.settings, mapByName(data.map), {
  ...(heist ? { heist } : {}),
  ...(data.classConfig ? { classConfig: data.classConfig } : {}),
  ...(data.ticketSecret
    ? { auth: ticketAuth(data.ticketSecret, data.requireTicket ?? false) }
    : {}),
  ...(stack
    ? {
        combat: () => stack.combatSettings(),
        world: () => stack.worldSettings(),
        challenges: stack.handler,
      }
    : {}),
});

analytics?.bind(game.match);
if (data.classConfig) {
  const classId = data.classConfig.classId;
  game.match.heist.events.subscribe((event) => {
    if (event.type === 'round_end')
      parentPort?.postMessage({
        type: 'round_result',
        classId,
        result: event.result,
      } satisfies MatchWorkerMessage);
  });
}

http.listen(data.port, () => {
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : data.port;
  parentPort?.postMessage({ type: 'ready', port } satisfies MatchWorkerMessage);
});

const report = setInterval(() => {
  parentPort?.postMessage({
    type: 'metrics',
    metrics: game.metrics(),
  } satisfies MatchWorkerMessage);
}, 1000);

parentPort?.on('message', (message: { type: string } | ClassCommand) => {
  if (message.type === 'reload') {
    stack?.invalidate();
    return;
  }
  if (applyClassCommand(game.match, message as ClassCommand)) return;
  if (message.type !== 'stop') return;
  clearInterval(report);
  void game
    .stop()
    .then(() => analytics?.flush())
    .then(() => stack?.close())
    .then(() => {
      http.close();
      process.exit(0);
    });
});

/** Teacher commands for a class room; false when the message is not one. */
function applyClassCommand(match: Match, command: ClassCommand): boolean {
  switch (command.type) {
    case 'class_config':
      match.applyClassConfig(command.config);
      return true;
    case 'end_round':
      match.heist.endRound();
      return true;
    case 'next_round':
      match.heist.startNextRound();
      return true;
    case 'kick': {
      const id = match.playerIdOfAccount(command.accountId);
      if (id !== undefined) match.kick(id);
      return true;
    }
    case 'rename':
      match.renameByAccount(command.accountId, command.name);
      return true;
    default:
      return false;
  }
}
