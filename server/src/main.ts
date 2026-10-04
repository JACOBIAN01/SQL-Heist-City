import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { attachChallengeSocket } from './challenges/ChallengeSocket';
import { buildChallengeStack, type ChallengeStack } from './composition';
import { openDatabase } from './db/database';
import { DEFAULT_MATCH_SETTINGS } from '@heist/shared';
import { MatchPool } from './game/MatchPool';
import { mapByName, parseMapName } from './game/maps';
import { startGame, type RunningGame } from './game/startGame';
import { createHttpServer } from './http/httpServer';

// Entry point: reads the environment, then wires concrete dependencies.
const port = Number(process.env.PORT ?? 8080);
const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../../data/dev.db', import.meta.url));

// The admin service owns the schema; the game only reads. Until the admin has
// created the database there are no questions to serve.
let challenges: ChallengeStack | undefined;
if (existsSync(dbPath)) {
  challenges = buildChallengeStack(openDatabase({ path: dbPath, readOnly: true }), {
    logger: { warn: (message, meta) => console.warn(message, meta ?? '') },
  });
} else {
  console.warn(`no database at ${dbPath} yet — start the admin and run db:seed first`);
}

// The HTTP server is created first (the game attaches to it), so metrics look the game up lazily.
// MATCH_MAP=city (default)|city:<seed>|heist|sandbox|bench. Load tests: MATCH_MAX_PLAYERS=200, MATCH_DUMMIES=0, MATCH_MAP=bench (640 m).
const mapName = parseMapName(process.env.MATCH_MAP);
const matchSettings = {
  ...DEFAULT_MATCH_SETTINGS,
  maxPlayers: Number(process.env.MATCH_MAX_PLAYERS ?? DEFAULT_MATCH_SETTINGS.maxPlayers),
  sandboxDummies: Number(process.env.MATCH_DUMMIES ?? DEFAULT_MATCH_SETTINGS.sandboxDummies),
};
const running: { game?: RunningGame; pool?: MatchPool } = {};
const lobby = () => {
  if (running.pool) return { matches: running.pool.list(), open: running.pool.openMatch() };
  // One in-process match on this server's own port.
  const players = running.game?.metrics().players ?? 0;
  const max = matchSettings.maxPlayers;
  const only = { id: 0, port, players, maxPlayers: max };
  return { matches: [only], open: players < max ? only : undefined };
};
const server = createHttpServer({
  lobby,
  metrics: () => (running.pool ? running.pool.metrics() : (running.game?.metrics() ?? {})),
  now: Date.now,
  startedAt: Date.now(),
  ...(process.env.INTERNAL_SECRET ? { internalSecret: process.env.INTERNAL_SECRET } : {}),
  onReload: () => {
    challenges?.invalidate();
    running.pool?.reload();
    console.log('reloaded questions and settings');
  },
});
if (challenges) attachChallengeSocket(server, challenges.handler);
// MATCH_WORKERS=N runs N matches, each in its own thread on its own port (the lobby tells
// clients where); 0 (default) runs one match in this process.
const workers = Number(process.env.MATCH_WORKERS ?? 0);
if (workers > 0) {
  running.pool = new MatchPool();
  for (let i = 0; i < workers; i++) {
    const info = await running.pool.start(matchSettings, 0, mapName, {
      ...(challenges ? { heist: challenges.heistSettings(), dbPath } : {}),
    });
    console.log(`match ${info.id} listening on ws://localhost:${info.port}/ws/game`);
  }
} else {
  running.game = startGame(server, matchSettings, mapByName(mapName), {
    ...(challenges ? { heist: challenges.heistSettings(), challenges: challenges.handler } : {}),
  });
}

server.listen(port, () => {
  console.log(`game server listening on http://localhost:${port}`);
  if (!running.pool) console.log(`game socket: ws://localhost:${port}/ws/game`);
  console.log(`lobby: http://localhost:${port}/lobby`);
  if (challenges) console.log(`challenge socket: ws://localhost:${port}/ws/challenge`);
});
