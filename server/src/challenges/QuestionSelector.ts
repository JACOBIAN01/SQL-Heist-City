import { MAX_TIER, MIN_TIER, type Rng, type TaskKind, type TierRange } from '@heist/shared';
import type { QuestionReader, StoredQuestion } from '../questions/QuestionRepository';

/**
 * Picks which question a player gets for a reward. Rules:
 * 1. Only enabled questions within the reward's tier range.
 * 2. No repeats for the same player + reward until every candidate was used;
 *    then the cycle restarts (avoiding the question they just had).
 * 3. If a tier range has no questions (e.g. a teacher disabled them all), widen
 *    one tier at a time so the game never dead-ends.
 *
 * One selector lives per match; its history dies with the match.
 */
export class QuestionSelector {
  /** `${player}\0${reward}` → question ids used in the current cycle. */
  private readonly used = new Map<string, Set<number>>();
  private readonly last = new Map<string, number>();

  constructor(private readonly questions: QuestionReader) {}

  /**
   * `allowed`: only these question ids may be chosen (a class's released set). An
   * empty set yields nothing; tiers widen only inside the set, so a class with
   * a few questions still always gets one of them.
   */
  select(
    player: string,
    reward: string,
    tiers: TierRange,
    rng: Rng,
    allowed?: ReadonlySet<number>,
    /** Prefer questions on these topics (spaced repetition); ignored when none are available in range. */
    focus?: ReadonlySet<string>,
    /** Only these topics (the practice drill's chosen topic); nothing else is ever drawn. */
    only?: ReadonlySet<string>,
    /** Only these kinds of task (an open brief never comes up at a vault lock). */
    kinds?: ReadonlySet<TaskKind>,
  ): StoredQuestion | undefined {
    let candidates = this.candidates(tiers, allowed, kinds);
    if (only && only.size > 0)
      candidates = candidates.filter((q) => q.template.topic.some((t) => only.has(t)));
    if (focus && focus.size > 0) {
      const onTopic = candidates.filter((q) => q.template.topic.some((t) => focus.has(t)));
      if (onTopic.length > 0) candidates = onTopic;
    }
    if (candidates.length === 0) return undefined;

    const key = `${player}\0${reward}`;
    let used = this.used.get(key);
    if (!used) this.used.set(key, (used = new Set()));

    let fresh = candidates.filter((q) => !used.has(q.id));
    if (fresh.length === 0) {
      used.clear();
      const previous = this.last.get(key);
      fresh = candidates.length > 1 ? candidates.filter((q) => q.id !== previous) : candidates;
    }

    const chosen = rng.pick(fresh);
    used.add(chosen.id);
    this.last.set(key, chosen.id);
    return chosen;
  }

  /** One question by slug, if it exists and is enabled (the tutorial's fixed questions). */
  bySlug(slug: string): StoredQuestion | undefined {
    const q = this.questions.getBySlug(slug);
    return q?.enabled ? q : undefined;
  }

  /** Forget a player's history (e.g. they left the match). */
  forgetPlayer(player: string): void {
    const prefix = `${player}\0`;
    for (const map of [this.used, this.last]) {
      for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
    }
  }

  /**
   * The same question for everyone who asks with the same rng (a duel's draw): chosen from the
   * candidates in id order, ignoring what each player has already seen, so two players can never
   * be handed different questions by their own history.
   */
  selectShared(
    tiers: TierRange,
    rng: Rng,
    allowed?: ReadonlySet<number>,
    kinds?: ReadonlySet<TaskKind>,
  ): StoredQuestion | undefined {
    const found = this.candidates(tiers, allowed, kinds).sort((a, b) => a.id - b.id);
    return found.length === 0 ? undefined : found[rng.int(0, found.length - 1)];
  }

  private candidates(
    tiers: TierRange,
    allowed?: ReadonlySet<number>,
    kinds?: ReadonlySet<TaskKind>,
  ): StoredQuestion[] {
    if (allowed && allowed.size === 0) return [];
    for (let widen = 0; widen <= MAX_TIER - MIN_TIER; widen++) {
      const found = this.questions
        .list({
          enabled: true,
          tierMin: Math.max(MIN_TIER, tiers.min - widen),
          tierMax: Math.min(MAX_TIER, tiers.max + widen),
        })
        .filter((q) => !allowed || allowed.has(q.id))
        .filter((q) => !kinds || kinds.has(q.template.task.kind));
      if (found.length > 0) return found;
    }
    return [];
  }
}
