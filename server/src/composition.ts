import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AnalyticsSettings,
  CitySettings,
  CombatSettings,
  HeistSettings,
  TutorialSettings,
  WorldSettings,
} from '@heist/shared';
import { FanOutSink, type AttemptSink } from './analytics/AttemptSink';
import type { PracticeTopic } from './challenges/PracticeSocket';
import { ReviewKeeper } from './analytics/ReviewKeeper';
import { ChallengeMessageHandler } from './challenges/ChallengeMessageHandler';
import { ChallengeService, type ChallengeLogger } from './challenges/ChallengeService';
import { QuestionSelector } from './challenges/QuestionSelector';
import { CachedSettingsReader } from './config/CachedSettingsReader';
import { SqliteConceptReader, type ConceptReader } from './concepts/ConceptStore';
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
  /** Sends each player their review after a round; bind it to the match. */
  readonly review: ReviewKeeper;
  /** Heist rules as the admin has set them (read when a match starts). */
  heistSettings(): HeistSettings;
  /** Guns as the admin has set them (read when a match starts and at each new round). */
  combatSettings(): CombatSettings;
  /** How learning is measured (marks, thresholds). */
  analyticsSettings(): AnalyticsSettings;
  /** Heist rules, cars and time of day, read again at each new round. */
  worldSettings(): WorldSettings;
  /** City generation settings, read when a match is created. */
  citySettings(): CitySettings;
  /** The tutorial as the admin has set it (read for every new tutorial room). */
  tutorialSettings(): TutorialSettings;
  /** A question's slug by id (assessments list questions by id). */
  slugOf(questionId: number): string | undefined;
  /** Topics a student can drill on their own (Phase 16.9). */
  practiceTopics(): PracticeTopic[];
  /** Drop cached questions and settings (admin edited something). */
  invalidate(): void;
  close(): Promise<void>;
}

export interface ChallengeStackOptions {
  readonly logger?: ChallengeLogger;
  /** Tests run SQL in-process; production isolates it in worker threads. */
  readonly sandbox?: SandboxRunner;
  readonly matchSeed?: string;
  /** Hears what happens to every issued question (the learning record). */
  readonly attempts?: AttemptSink;
  /** Concept cards for the free hint steps (default: none). */
  readonly concepts?: ConceptReader;
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
  const concepts = options.concepts ?? new SqliteConceptReader(db);
  const review = new ReviewKeeper(concepts);
  const service = new ChallengeService({
    matchSeed: options.matchSeed ?? randomUUID(),
    selector: new QuestionSelector(questions),
    variants: new VariantBuilder(builtInDatasets),
    grader: new Grader(sandbox),
    settings,
    ...(options.logger ? { logger: options.logger } : {}),
    attempts: options.attempts ? new FanOutSink([options.attempts, review]) : review,
    ...(concepts ? { concepts } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return {
    review,
    handler: new ChallengeMessageHandler(service, settings, options.now),
    heistSettings: () => settings.heistSettings(),
    combatSettings: () => settings.combatSettings(),
    tutorialSettings: () => settings.tutorialSettings(),
    practiceTopics: () => practiceTopicsOf(questions, concepts),
    slugOf: (id) => questions.getById(id)?.slug,
    analyticsSettings: () => settings.analyticsSettings(),
    worldSettings: () => worldSettingsFrom(settings),
    citySettings: () => settings.citySettings(),
    invalidate: () => {
      questions.invalidate();
      settings.invalidate();
      if (concepts instanceof SqliteConceptReader) concepts.invalidate();
    },
    close: () => sandbox.close(),
  };
}

/** Every topic that has an enabled question, with its concept card title and the tiers it appears in. */
function practiceTopicsOf(
  questions: CachedQuestionReader,
  concepts: ConceptReader,
): PracticeTopic[] {
  const by = new Map<string, { questions: number; tiers: Set<number> }>();
  for (const q of questions.list({ enabled: true }))
    for (const topic of q.template.topic) {
      const t = by.get(topic) ?? { questions: 0, tiers: new Set<number>() };
      t.questions++;
      t.tiers.add(q.template.tier);
      by.set(topic, t);
    }
  return [...by]
    .map(([topic, t]) => ({
      topic,
      title: concepts.get(topic)?.title ?? topic,
      questions: t.questions,
      tiers: [...t.tiers].sort(),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
