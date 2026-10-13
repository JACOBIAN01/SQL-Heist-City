import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  CitySettings,
  CombatSettings,
  HeistSettings,
  TutorialSettings,
  WorldSettings,
} from '@heist/shared';
import { ChallengeMessageHandler } from './challenges/ChallengeMessageHandler';
import { ChallengeService, type ChallengeLogger } from './challenges/ChallengeService';
import { QuestionSelector } from './challenges/QuestionSelector';
import { CachedSettingsReader } from './config/CachedSettingsReader';
import { SqliteSettingsReader, worldSettingsFrom } from './config/SettingsReader';
import { CachedQuestionReader } from './questions/CachedQuestionReader';
import { SqliteQuestionRepository } from './questions/SqliteQuestionRepository';
import { Grader } from './sql/Grader';
import type { SandboxRunner } from './sql/SandboxRunner';
import { WorkerSandboxRunner } from './sql/WorkerSandboxRunner';
import { builtInDatasets } from './variants/datasets';
import { VariantBuilder } from './variants/VariantBuilder';

export interface ChallengeStack {
  readonly handler: ChallengeMessageHandler;
  /** Heist rules as the admin has set them (read when a match starts). */
  heistSettings(): HeistSettings;
  /** Guns as the admin has set them (read when a match starts and at each new round). */
  combatSettings(): CombatSettings;
  /** Heist rules, cars and time of day, read again at each new round. */
  worldSettings(): WorldSettings;
  /** City generation settings, read when a match is created. */
  citySettings(): CitySettings;
  /** The tutorial as the admin has set it (read for every new tutorial room). */
  tutorialSettings(): TutorialSettings;
  /** Drop cached questions and settings (admin edited something). */
  invalidate(): void;
  close(): Promise<void>;
}

export interface ChallengeStackOptions {
  readonly logger?: ChallengeLogger;
  /** Tests run SQL in-process; production isolates it in worker threads. */
  readonly sandbox?: SandboxRunner;
  readonly matchSeed?: string;
  readonly now?: () => number;
}

/**
 * Wires everything a match needs to serve SQL challenges from one database
 * handle (read-only in production). The single place that `new`s the
 * concrete challenge services.
 */
export function buildChallengeStack(
  db: DatabaseSync,
  options: ChallengeStackOptions = {},
): ChallengeStack {
  const questions = new CachedQuestionReader(new SqliteQuestionRepository(db));
  const settings = new CachedSettingsReader(new SqliteSettingsReader(db));
  const sandbox = options.sandbox ?? new WorkerSandboxRunner();
  const service = new ChallengeService({
    matchSeed: options.matchSeed ?? randomUUID(),
    selector: new QuestionSelector(questions),
    variants: new VariantBuilder(builtInDatasets),
    grader: new Grader(sandbox),
    settings,
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return {
    handler: new ChallengeMessageHandler(service, settings, options.now),
    heistSettings: () => settings.heistSettings(),
    combatSettings: () => settings.combatSettings(),
    tutorialSettings: () => settings.tutorialSettings(),
    worldSettings: () => worldSettingsFrom(settings),
    citySettings: () => settings.citySettings(),
    invalidate: () => {
      questions.invalidate();
      settings.invalidate();
    },
    close: () => sandbox.close(),
  };
}
