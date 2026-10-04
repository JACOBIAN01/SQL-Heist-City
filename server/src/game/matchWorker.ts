import { createServer } from 'node:http';
import { parentPort, workerData } from 'node:worker_threads';
import type { MatchSettings } from '@heist/shared';
import { mapByName, type MapName } from './maps';
import { startGame } from './startGame';

/** What the pool hands each worker at startup. */
export interface MatchWorkerData {
  readonly matchId: number;
  /** TCP port to listen on; 0 picks a free one (it is reported back). */
  readonly port: number;
  readonly settings: MatchSettings;
  /** Which map to load (default: the sandbox yard). */
  readonly map?: MapName;
}

/** Messages worker → pool. */
export type MatchWorkerMessage =
  | { readonly type: 'ready'; readonly port: number }
  | {
      readonly type: 'metrics';
      readonly metrics: ReturnType<ReturnType<typeof startGame>['metrics']>;
    };

/**
 * One match, one thread: this file is the thread's entry point. It owns its own
 * HTTP + WebSocket listener, so a client connects straight to it and the match's
 * 20 Hz loop never competes with other matches (or the main process) for the
 * same event loop. The main process only keeps a lobby listing.
 */
const data = workerData as MatchWorkerData;
const http = createServer();
const game = startGame(http, data.settings, mapByName(data.map));

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

parentPort?.on('message', (message: { type: string }) => {
  if (message.type !== 'stop') return;
  clearInterval(report);
  void game.stop().then(() => {
    http.close();
    process.exit(0);
  });
});
