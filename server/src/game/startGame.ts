import type { Server } from 'node:http';
import { DEFAULT_MATCH_SETTINGS, TEST_MAP, type MatchSettings } from '@heist/shared';
import { GameLoop } from './GameLoop';
import { attachGameSocket, type GameSocket } from './GameSocket';
import { Match } from './Match';

export interface RunningGame {
  readonly match: Match;
  readonly loop: GameLoop;
  stop(): Promise<void>;
}

/** Wires one match to the HTTP server and starts ticking. Composition only, no rules. */
export function startGame(
  http: Server,
  settings: MatchSettings = DEFAULT_MATCH_SETTINGS,
): RunningGame {
  const match = new Match({ map: TEST_MAP, settings });
  const loop = new GameLoop(1000 / settings.tickRate, () => match.step());
  const socket: GameSocket = attachGameSocket(http, match);
  loop.start();
  return {
    match,
    loop,
    async stop() {
      loop.stop();
      await socket.close();
    },
  };
}
