import { MAX_TIER, MIN_TIER, type Rng, type TierRange } from '@heist/shared';
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

  select(player: string, reward: string, tiers: TierRange, rng: Rng): StoredQuestion | undefined {
    const candidates = this.candidates(tiers);
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

  /** Forget a player's history (e.g. they left the match). */
  forgetPlayer(player: string): void {
    const prefix = `${player}\0`;
    for (const map of [this.used, this.last]) {
      for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
    }
  }

  private candidates(tiers: TierRange): StoredQuestion[] {
    for (let widen = 0; widen <= MAX_TIER - MIN_TIER; widen++) {
      const found = this.questions.list({
        enabled: true,
        tierMin: Math.max(MIN_TIER, tiers.min - widen),
        tierMax: Math.min(MAX_TIER, tiers.max + widen),
      });
      if (found.length > 0) return found;
    }
    return [];
  }
}
