import { installCrashLogging, log } from './log';
import { renderPrometheus } from './net/prometheus';
import { upgradeRouterFor } from './net/UpgradeRouter';
import type { GameMetrics } from './game/startGame';
import { assertSecrets } from './config/secrets';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { attachAssessmentSocket } from './challenges/AssessmentSocket';
import { PgAssessmentStore } from './classes/AssessmentStore';
import { attachPracticeSocket } from './challenges/PracticeSocket';
import { attachChallengeSocket } from './challenges/ChallengeSocket';
import { buildChallengeStack, type ChallengeStack } from './composition';
import { openDatabase } from './db/database';
import { PgDatabase } from './pg/PgDatabase';
import { syncContent } from './pg/ContentSnapshot';
import { migratePg } from './pg/migrate';
import {
  DEFAULT_ANALYTICS_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  DEFAULT_PROGRESSION_SETTINGS,
  DEFAULT_STORY_SETTINGS,
  cityMapIdFor,
} from '@heist/shared';
import { PgAttemptStore } from './analytics/AttemptStore';
import { RetentionJob } from './analytics/RetentionJob';
import { AnalyticsKit } from './analytics/AnalyticsKit';
import { ClassRooms, type RoomAction } from './classes/ClassRooms';
import { PgClassResults } from './classes/ClassResults';
import { PgClassRepository } from './classes/ClassRepository';
import { ticketAuth } from './game/GameAuth';
import { MatchPool } from './game/MatchPool';
import { mapByName, parseMapName, type MapName } from './game/maps';
import { startGame, type RunningGame } from './game/startGame';
import { createHttpServer } from './http/httpServer';
import { attachTutorialSocket } from './tutorial/TutorialRooms';

installCrashLogging();

// Entry point: reads the environment, then wires concrete dependencies.
const port = Number(process.env.PORT ?? 8080);
let dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../../data/dev.db', import.meta.url));

// With DATABASE_URL, PostgreSQL is the system of record: the game reads a local snapshot of the
// content that is refreshed at start and whenever the admin asks for a reload (docs/identity.md).
let refreshContent: () => Promise<void> = async () => {};
let pg: PgDatabase | undefined;
if (process.env.DATABASE_URL) {
  pg = PgDatabase.open({ url: process.env.DATABASE_URL, max: 2 });
  await migratePg(pg);
  dbPath =
    process.env.SNAPSHOT_PATH ??
    fileURLToPath(new URL('../../data/content-snapshot.db', import.meta.url));
  const snapshot = openDatabase({ path: dbPath });
  refreshContent = async () => {
    const counts = await syncContent(pg as PgDatabase, snapshot);
    log.info('content snapshot refreshed', {
      questions: counts.questions,
      settings: counts.settings,
    });
  };
  await refreshContent();
}

// The admin service owns the schema; the game only reads. Until the admin has
// created the database there are no questions to serve.
let challenges: ChallengeStack | undefined;
// The learning record for the open match and the tutorial (class rooms record in their own threads).
const analytics = pg
  ? new AnalyticsKit(
      pg,
      () => challenges?.analyticsSettings() ?? DEFAULT_ANALYTICS_SETTINGS,
      undefined,
      () => challenges?.progressionSettings() ?? DEFAULT_PROGRESSION_SETTINGS,
      () => challenges?.storySettings() ?? DEFAULT_STORY_SETTINGS,
    )
  : undefined;
if (existsSync(dbPath)) {
  challenges = buildChallengeStack(openDatabase({ path: dbPath, readOnly: true }), {
    logger: { warn: (message, meta) => log.warn(message, meta) },
    ...(analytics ? { attempts: analytics.sink } : {}),
  });
} else {
  log.warn('no database yet: start the admin and run db:seed first', { dbPath });
}

// The HTTP server is created first (the game attaches to it), so metrics look the game up lazily.
// MATCH_MAP=city (default)|city:<seed>|heist|sandbox|bench. Load tests: MATCH_MAX_PLAYERS=200, MATCH_DUMMIES=0, MATCH_MAP=bench (640 m).
// Without MATCH_MAP the city is whatever the admin's city settings describe (read once: a city cannot change under a running match).
const mapName: MapName =
  !process.env.MATCH_MAP && challenges
    ? (cityMapIdFor(challenges.citySettings()) as MapName)
    : parseMapName(process.env.MATCH_MAP);
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
// Sign-in: tickets signed with TICKET_SECRET (the same secret the account service uses). In
// production a ticket is required; in development an unsigned join with a typed name still works.
const production = process.env.NODE_ENV === 'production';
const ticketSecret = process.env.TICKET_SECRET ?? (production ? undefined : 'dev-ticket-secret');
const requireTicket = production || process.env.REQUIRE_TICKET === '1';
if (production && !ticketSecret) throw new Error('TICKET_SECRET is required in production');
assertSecrets(process.env, { required: ['TICKET_SECRET'], optional: ['INTERNAL_SECRET'] });
const auth = ticketSecret ? ticketAuth(ticketSecret, requireTicket) : undefined;
// Class rooms (one match per class, in its own thread) exist when PostgreSQL holds the classes.
const classResults = pg ? new PgClassResults(pg) : undefined;
const classPool = pg
  ? new MatchPool((classId, result) => {
      classResults?.record(classId, result).catch((err: unknown) => {
        log.error('could not record a class round', { classId, round: result.number, err });
      });
    })
  : undefined;
let rooms: ClassRooms | undefined;
const startedAt = Date.now();
const matchPorts = (): number[] => [
  ...(running.pool?.list() ?? []).map((m) => m.port),
  ...(classPool?.list() ?? []).map((m) => m.port),
];
let clientErrors = 0;
const server = createHttpServer({
  ...(classPool
    ? {
        classRooms: {
          status: (id: number) => rooms?.status(id) ?? { state: 'waiting' },
          handle: async (id: number, body: unknown) =>
            rooms ? rooms.handle(id, body as RoomAction) : { ok: false, reason: 'unknown_class' },
        },
      }
    : {}),
  lobby,
  metrics: () => (running.pool ? running.pool.metrics() : (running.game?.metrics() ?? {})),
  prometheus: () => {
    const matches: Record<string, GameMetrics | undefined> = {};
    if (running.game) matches.main = running.game.metrics();
    for (const [id, m] of Object.entries(running.pool?.metrics() ?? {})) matches[`match-${id}`] = m;
    for (const [id, m] of Object.entries(classPool?.metrics() ?? {})) matches[`class-${id}`] = m;
    return renderPrometheus({
      uptimeSeconds: (Date.now() - startedAt) / 1000,
      matches,
      sandbox: challenges?.sandboxStats(),
      clientErrors,
      rssBytes: process.memoryUsage().rss,
      heapBytes: process.memoryUsage().heapUsed,
    });
  },
  protectMetrics: production,
  onClientError: (error) => {
    clientErrors++;
    log.warn('client error', { ...error });
  },
  now: Date.now,
  startedAt,
  ...(process.env.INTERNAL_SECRET ? { internalSecret: process.env.INTERNAL_SECRET } : {}),
  onReload: async () => {
    await refreshContent();
    challenges?.invalidate();
    running.pool?.reload();
    classPool?.reload();
    log.info('reloaded questions and settings');
  },
});
if (challenges) {
  attachChallengeSocket(server, challenges.handler);
  // Pre/post assessments of a class (Phase 16.10): needs PostgreSQL (classes, rosters, answers).
  if (pg) {
    const attemptsStore = new PgAttemptStore(pg);
    attachAssessmentSocket(server, challenges.handler, {
      assessments: new PgAssessmentStore(pg),
      slugOf: (id) => challenges.slugOf(id),
      answered: (account, classId, kind) => attemptsStore.assessed(account, classId, kind),
      ...(auth ? { auth } : {}),
    });
  }
  // The solo drill: practise a topic with no match (Phase 16.9).
  attachPracticeSocket(server, challenges.handler, {
    topics: () => challenges.practiceTopics(),
    ...(auth ? { auth } : {}),
  });
  // The tutorial: a private room per player, always on this port (it needs the questions).
  attachTutorialSocket(
    server,
    {
      settings: () => challenges.tutorialSettings(),
      match: matchSettings,
      heist: challenges.heistSettings(),
      combat: () => challenges.combatSettings(),
      challenges: challenges.handler,
    },
    auth ? { auth } : {},
  );
}
if (pg && challenges) {
  // Old raw events and items are pruned once a day (docs/privacy.md); profile totals stay.
  const stack = challenges;
  new RetentionJob(
    new PgAttemptStore(pg),
    () => stack.analyticsSettings(),
    Date.now,
    (m) => log.info(m),
  ).start(undefined, (err) => log.error('retention failed', { err }));
}
if (pg && classPool && challenges) {
  const stack = challenges;
  rooms = new ClassRooms({
    classes: new PgClassRepository(pg),
    pool: classPool,
    matchSettings,
    extras: () => ({
      dbPath,
      ...(process.env.DATABASE_URL ? { databaseUrl: process.env.DATABASE_URL } : {}),
      ...(ticketSecret ? { ticketSecret, requireTicket } : {}),
    }),
    city: () => stack.citySettings(),
    heist: () => stack.heistSettings(),
    modes: () => stack.modesSettings(),
  });
  log.info('class rooms on: teachers start a room from the admin');
}
// MATCH_WORKERS=N runs N matches, each in its own thread on its own port (the lobby tells
// clients where); 0 (default) runs one match in this process.
const workers = Number(process.env.MATCH_WORKERS ?? 0);
if (workers > 0) {
  running.pool = new MatchPool();
  for (let i = 0; i < workers; i++) {
    const info = await running.pool.start(matchSettings, 0, mapName, {
      ...(challenges ? { heist: challenges.heistSettings(), dbPath } : {}),
      ...(process.env.DATABASE_URL ? { databaseUrl: process.env.DATABASE_URL } : {}),
      ...(ticketSecret ? { ticketSecret, requireTicket } : {}),
    });
    log.info('match listening', { match: info.id, port: info.port });
  }
} else {
  running.game = startGame(server, matchSettings, mapByName(mapName), {
    ...(challenges
      ? {
          heist: challenges.heistSettings(),
          combat: () => challenges.combatSettings(),
          world: () => challenges.worldSettings(),
          challenges: challenges.handler,
        }
      : {}),
    ...(auth ? { auth } : {}),
  });
  analytics?.bind(running.game.match);
  challenges?.review.bind(running.game.match);
}

upgradeRouterFor(server).allowRelay((p) => matchPorts().includes(p));
server.listen(port, () => {
  log.info('game server listening', { port });
});
