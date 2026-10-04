import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { attachChallengeSocket } from './challenges/ChallengeSocket';
import { buildChallengeStack, type ChallengeStack } from './composition';
import { openDatabase } from './db/database';
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
const running: { game?: RunningGame } = {};
const server = createHttpServer({
  metrics: () => running.game?.metrics() ?? {},
  now: Date.now,
  startedAt: Date.now(),
  ...(process.env.INTERNAL_SECRET ? { internalSecret: process.env.INTERNAL_SECRET } : {}),
  onReload: () => {
    challenges?.invalidate();
    console.log('reloaded questions and settings');
  },
});
if (challenges) attachChallengeSocket(server, challenges.handler);
running.game = startGame(server);

server.listen(port, () => {
  console.log(`game server listening on http://localhost:${port}`);
  console.log(`game socket: ws://localhost:${port}/ws/game`);
  if (challenges) console.log(`challenge socket: ws://localhost:${port}/ws/challenge`);
});
