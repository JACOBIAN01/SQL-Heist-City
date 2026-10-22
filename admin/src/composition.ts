import { PrivacyRetention } from './players/PrivacyRetention';
import { log } from '@heist/server/log';
import { DEFAULT_RATE_LIMITS, type RateLimits } from '@heist/shared';
import { KeyedLimiter } from '@heist/server/net/KeyedLimiter';
import type { Express } from 'express';
import { AuthService } from './auth/AuthService';
import { LoginRateLimiter } from './auth/LoginRateLimiter';
import { csrfGuard, session } from './auth/middleware';
import { ScryptPasswordHasher, type PasswordHasher } from './auth/PasswordHasher';
import { authRoutes } from './auth/routes';
import type { AdminStores } from './stores';
import { createAdminApp } from './http/app';
import type { ErrorLogger } from './http/errors';
import { userRoutes } from './users/routes';
import { AdminEventBus } from './events/AdminEvents';
import { auditAdminEvents } from './audit/AuditLog';
import { auditRoutes } from './audit/routes';
import { QuestionAdminService } from './questions/QuestionAdminService';
import { questionRoutes } from './questions/routes';
import { QuestionTester } from './questions/QuestionTester';
import { SandboxTemplateValidator } from './questions/TemplateValidator';
import { QuestionImportService } from './questions/io/QuestionImportService';
import { SettingsService } from './config/SettingsService';
import { configRoutes } from './config/routes';
import { PlayerProfileService } from './players/PlayerProfileService';
import { LeagueService } from '@heist/server/progress/LeagueService';
import { PersonalDataRegistry, accountSource } from '@heist/server/players/PersonalData';
import { HttpGameControl, type GameControl } from './classes/GameControl';
import { conceptRoutes } from './concepts';
import { analyticsRoutes } from './analytics/routes';
import { briefRoutes } from './analytics/briefs';
import { classRoutes } from './classes/classRoutes';
import { playerStaffRoutes } from './players/staffRoutes';
import {
  ANALYTICS_SETTINGS_KEY,
  NAME_RULES_KEY,
  PRIVACY_SETTINGS_KEY,
  PROGRESSION_SETTINGS_KEY,
  settingsParsers,
} from '@heist/server/config/SettingsReader';
import { playerRoutes, type PlayerAuthOptions } from './players/playerRoutes';
import { poolRoutes } from './pools/routes';
import { ReloadNotifier } from './reload/ReloadNotifier';
import { Grader } from '@heist/server/sql/Grader';
import type { SandboxRunner } from '@heist/server/sql/SandboxRunner';
import { WorkerSandboxRunner } from '@heist/server/sql/WorkerSandboxRunner';
import { builtInDatasets } from '@heist/server/variants/datasets';
import { VariantBuilder } from '@heist/server/variants/VariantBuilder';

export interface AdminConfig {
  readonly secureCookies: boolean;
  readonly sessionTtlMs: number;
  readonly uiDistDir?: string;
  /** Google sign-in for players; without it the player routes are not mounted. */
  readonly playerAuth?: Pick<
    PlayerAuthOptions,
    | 'oidc'
    | 'ticketSecret'
    | 'cookieSecret'
    | 'gameOrigins'
    | 'allowedDomains'
    | 'devLogin'
    | 'googleEnabled'
  >;
  /** When set, admin changes trigger a cache reload on the game server. */
  readonly gameServer?: { readonly url: string; readonly secret: string };
  /** Per-address request limits; the defaults when absent. */
  readonly rateLimits?: RateLimits;
}

export interface AdminOverrides {
  /** Tests use a fast hasher; production uses scrypt defaults. */
  readonly hasher?: PasswordHasher;
  readonly now?: () => number;
  /** Tests run SQL in-process; production isolates it in worker threads. */
  readonly sandbox?: SandboxRunner;
  /** How the admin reaches the running game (live class controls); production builds an HTTP one. */
  readonly gameControl?: GameControl;
}

export interface Admin {
  readonly app: Express;
  readonly auth: AuthService;
  readonly events: AdminEventBus;
  /** Bulk import/export, used by the seed script. */
  readonly io: QuestionImportService;
  /** The daily deletion of what is past its time (Phase 21.4); main.ts starts it. */
  readonly retention: PrivacyRetention;
  /** Resolves when the audit writes so far have landed (tests and shutdown). */
  settled(): Promise<void>;
  /** Release worker threads on shutdown. */
  close(): Promise<void>;
}

/**
 * Composition root for the admin service: builds every repository and
 * service from one database handle. main.ts and integration tests both use it,
 * so tests exercise the real wiring.
 */
export function buildAdmin(
  stores: AdminStores,
  config: AdminConfig,
  logger: ErrorLogger,
  overrides: AdminOverrides = {},
): Admin {
  const now = overrides.now ?? Date.now;
  const users = stores.users;
  const sessions = stores.sessions(config.sessionTtlMs, now);
  const auth = new AuthService(users, sessions, overrides.hasher ?? new ScryptPasswordHasher());
  const limiter = new LoginRateLimiter(5, 15 * 60 * 1000, now);
  const events = new AdminEventBus();
  const audit = stores.audit;
  const auditing = auditAdminEvents(events, audit, (err) =>
    logger.error('audit write failed', { error: String(err) }),
  );
  const reload = config.gameServer
    ? new ReloadNotifier({
        gameServerUrl: config.gameServer.url,
        secret: config.gameServer.secret,
        logger: { warn: (m, meta) => logger.error(m, meta) },
      })
    : undefined;
  reload?.attach(events);
  const sandbox = overrides.sandbox ?? new WorkerSandboxRunner({ size: 2 });
  const tester = new QuestionTester(new VariantBuilder(builtInDatasets), new Grader(sandbox));
  const validator = new SandboxTemplateValidator(tester);
  const questions = new QuestionAdminService(stores.questions, events, validator);
  const io = new QuestionImportService(questions, validator);
  const settings = new SettingsService(stores.settings, events);

  // Everything that keeps data about a player registers here, so export and deletion stay complete.
  const playerSessions = stores.playerSessions(config.sessionTtlMs, now);
  const personalData = new PersonalDataRegistry()
    .register({
      name: 'auditTrail',
      export: async () => ({
        note: 'Staff actions about your account (renames) are kept without names.',
      }),
      erase: async (p) => stores.audit.scrubDetail('player', String(p.id)),
    })
    .register({
      name: 'settings',
      export: async (p) => (await stores.playerSettings.get(p.id)) ?? null,
      // The database removes them with the account (ON DELETE CASCADE); this covers memory stores.
      erase: async (p) => stores.playerSettings.remove(p.id),
    })
    .register({
      name: 'progress',
      export: async (p) => stores.progress.get(p.id),
      erase: async (p) => stores.progress.remove(p.id),
    })
    .register({
      name: 'contracts',
      export: async (p) => ({ streak: await stores.contracts.getStreak(p.id) }),
      erase: async (p) => stores.contracts.remove(p.id),
    })
    .register({
      name: 'loadout',
      export: async (p) => stores.loadout.get(p.id),
      erase: async (p) => stores.loadout.remove(p.id),
    })
    .register({
      name: 'briefs',
      export: async (p) => stores.briefs.ofPlayer(p.id),
      // PostgreSQL removes a player's briefs with the account (ON DELETE CASCADE).
      erase: async () => {},
    })
    // The account goes last: a failure above leaves an account that can try again.
    .register(accountSource(stores.players, playerSessions));
  const gameControl =
    overrides.gameControl ??
    (config.gameServer
      ? new HttpGameControl(config.gameServer.url, config.gameServer.secret)
      : undefined);
  const privacySettings = async () =>
    settingsParsers.privacyFrom(await stores.settings.get(PRIVACY_SETTINGS_KEY));
  const nameRules = async () =>
    settingsParsers.namesFrom(await stores.settings.get(NAME_RULES_KEY));

  const profiles = new PlayerProfileService({
    progress: stores.progress,
    loadout: stores.loadout,
    contracts: stores.contracts,
    attempts: stores.attempts,
    profiles: stores.profiles,
    results: stores.classResults,
    progression: async () =>
      settingsParsers.progressionFrom(await stores.settings.get(PROGRESSION_SETTINGS_KEY)),
    analytics: async () =>
      settingsParsers.analyticsFrom(await stores.settings.get(ANALYTICS_SETTINGS_KEY)),
    now,
  });

  const limits = config.rateLimits ?? DEFAULT_RATE_LIMITS;
  const app = createAdminApp({
    logger,
    limits: {
      api: new KeyedLimiter(limits.adminApiPerIp, now),
      auth: new KeyedLimiter(limits.authPerIp, now),
    },
    ...(config.playerAuth
      ? {
          root: [
            playerRoutes({
              ...config.playerAuth,
              players: stores.players,
              nameRules: nameRules,
              privacy: privacySettings,
              settings: stores.playerSettings,
              profile: (player) => profiles.build(player),
              personalData,
              classes: stores.classes,
              sessions: playerSessions,
              secureCookies: config.secureCookies,
              sessionTtlMs: config.sessionTtlMs,
              now,
            }),
          ],
        }
      : {}),
    ...(config.uiDistDir === undefined ? {} : { uiDistDir: config.uiDistDir }),
    apiMiddleware: [csrfGuard, session(auth)],
    api: [
      authRoutes(auth, limiter, config),
      userRoutes(auth, events),
      questionRoutes(questions, tester, io),
      auditRoutes(audit),
      configRoutes(settings),
      poolRoutes(stores.pools, events),
      playerStaffRoutes(stores.players, nameRules, events),
      conceptRoutes(stores.concepts, events),
      analyticsRoutes({
        classes: stores.classes,
        questions: stores.questions,
        players: stores.players,
        attempts: stores.attempts,
        profiles: stores.profiles,
        assessments: stores.assessments,
        events,
        settings: async () =>
          settingsParsers.analyticsFrom(await stores.settings.get(ANALYTICS_SETTINGS_KEY)),
      }),
      briefRoutes({
        briefs: stores.briefs,
        classes: stores.classes,
        attempts: stores.attempts,
        profiles: stores.profiles,
        events,
        now,
      }),
      classRoutes({
        classes: stores.classes,
        results: stores.classResults,
        profiles: stores.profiles,
        analytics: async () =>
          settingsParsers.analyticsFrom(await stores.settings.get(ANALYTICS_SETTINGS_KEY)),
        league: new LeagueService(
          stores.classResults,
          stores.attempts,
          async () =>
            settingsParsers.progressionFrom(await stores.settings.get(PROGRESSION_SETTINGS_KEY)),
          async (id) => (await stores.players.findById(id))?.displayName,
        ),
        questions: stores.questions,
        players: stores.players,
        events,
        nameRules,
        ...(gameControl ? { game: gameControl } : {}),
      }),
    ],
  });
  const retention = new PrivacyRetention({
    players: stores.players,
    classes: stores.classes,
    briefs: stores.briefs,
    personalData,
    settings: privacySettings,
    events,
    now,
    log: (message, fields) => log.info(message, fields),
  });
  return {
    app,
    auth,
    events,
    io,
    /** The daily clean-up of what is past its time; started by main.ts. */
    retention,
    settled: () => auditing.flush(),
    close: async () => {
      await auditing.flush();
      await reload?.flush();
      await sandbox.close();
    },
  };
}
