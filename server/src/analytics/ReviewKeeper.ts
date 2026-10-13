import type { ItemRecord, ReviewItem, ReviewMessage } from '@heist/shared';
import type { ConceptReader } from '../concepts/ConceptStore';
import type { Match } from '../game/Match';
import type { AttemptEvent, AttemptSink, AttemptWho } from './AttemptSink';

/** Most questions kept per player per round (a flood of switches must not grow memory). */
const MAX_PER_PLAYER = 60;

/**
 * Remembers the questions each player met this round and, when the round ends,
 * sends each of them their review (Phase 16.2). In memory only: nothing about
 * a query is stored, and nothing is sent while the round is still on.
 *
 * Pattern: Observer (an AttemptSink) — Why: grading code does not change; the review is another
 * listener on "a question ended", and the round end event decides when it is delivered.
 */
export class ReviewKeeper implements AttemptSink {
  private readonly byPlayer = new Map<string, ItemRecord[]>();
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly concepts: ConceptReader) {}

  event(_event: AttemptEvent): void {}

  item(item: ItemRecord, who: AttemptWho): void {
    if (!who.playerKey || !item.review || item.tutorial) return;
    const list = this.byPlayer.get(who.playerKey) ?? [];
    list.push(item);
    if (list.length > MAX_PER_PLAYER) list.shift();
    this.byPlayer.set(who.playerKey, list);
  }

  /** A player left: nothing to review for them any more. */
  forget(playerKey: string): void {
    this.byPlayer.delete(playerKey);
  }

  /** Send every player their review when a round ends, then start the next round empty. */
  bind(match: Match): void {
    this.unsubscribe?.();
    this.unsubscribe = match.heist.events.subscribe((event) => {
      if (event.type !== 'round_end') return;
      for (const player of match.playerList()) {
        const items = this.byPlayer.get(player.key);
        if (items && items.length > 0)
          match.sendJson(player, this.messageFor(event.result.number, items));
      }
      this.byPlayer.clear();
    });
    match.onPlayerLeft((player) => this.forget(player.key));
  }

  messageFor(round: number, items: readonly ItemRecord[]): ReviewMessage {
    return { t: 'review', round, items: items.map((i) => this.toView(i)) };
  }

  private toView(i: ItemRecord): ReviewItem {
    const cards = i.topics.flatMap((topic) => {
      const c = this.concepts.get(topic);
      return c ? [{ topic, title: c.title, body_md: c.body_md }] : [];
    });
    const review = i.review as NonNullable<ItemRecord['review']>;
    return {
      title: review.title,
      story: review.story,
      outcome: i.outcome,
      rewardKey: i.rewardKey,
      tier: i.tier,
      rcsbe: i.rcsbe,
      topics: i.topics,
      secondsOpen: Math.round(i.secondsOpen),
      hintsUsed: i.hintsPaid,
      yourSql: review.lastSql ?? null,
      modelSql: review.modelSql,
      cards,
    };
  }
}
