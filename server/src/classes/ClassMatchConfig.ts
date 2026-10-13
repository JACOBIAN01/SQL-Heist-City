import type { IssueOptions } from '../challenges/ChallengeService';
import {
  QUESTION_USAGES,
  usageOfReward,
  type ClassRecord,
  type ClassQuestionLink,
  type QuestionUsage,
} from '@heist/shared';

/**
 * Everything a match needs to know about the class it was started for. A plain
 * data object, so it can be handed to a match thread and rebuilt after a teacher's edit.
 */
export interface ClassMatchConfig {
  readonly classId: number;
  readonly code: string;
  readonly name: string;
  readonly playerCap: number;
  /** Round length (minutes) that overrides the heist setting; null keeps it. */
  readonly roundMinutes: number | null;
  readonly citySeed: string | null;
  /** Bank tiers whose vaults may be worked. */
  readonly banksOpen: readonly number[];
  /** Released question ids by what they may be used for. */
  readonly questions: Readonly<Record<QuestionUsage, readonly number[]>>;
}

export function classMatchConfig(
  record: ClassRecord,
  links: readonly ClassQuestionLink[],
): ClassMatchConfig {
  const questions = Object.fromEntries(
    QUESTION_USAGES.map((u) => [u, links.filter((l) => l.usage === u).map((l) => l.questionId)]),
  ) as Record<QuestionUsage, number[]>;
  return {
    classId: record.id,
    code: record.code,
    name: record.name,
    playerCap: record.playerCap,
    roundMinutes: record.roundMinutes,
    citySeed: record.citySeed,
    banksOpen: record.banksOpen,
    questions,
  };
}

/** Bank tiers (1–5) that are closed, given which are open. */
export const closedTiers = (banksOpen: readonly number[], tiers = [1, 2, 3, 4, 5]): Set<number> =>
  new Set(tiers.filter((t) => !banksOpen.includes(t)));

/**
 * How a class match asks for each task: only from the questions the teacher
 * released for that kind of task. A kind with nothing released has an empty
 * set, so no question is ever asked for it.
 */
export function classTaskOptions(config: ClassMatchConfig): (rewardKey: string) => IssueOptions {
  const sets = new Map<QuestionUsage, ReadonlySet<number>>(
    QUESTION_USAGES.map((u) => [u, new Set(config.questions[u])]),
  );
  const none: ReadonlySet<number> = new Set();
  return (rewardKey) => {
    const usage = usageOfReward(rewardKey);
    return { allowedQuestions: (usage && sets.get(usage)) || none };
  };
}
