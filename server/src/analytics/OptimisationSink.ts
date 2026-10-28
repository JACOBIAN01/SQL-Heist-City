import type { BoardSummary, ItemRecord, LeaderboardMessage } from '@heist/shared';
import type { LeaderboardStore, BoardView } from '../progress/LeaderboardStore';
import type { AttemptEvent, AttemptSink, AttemptWho } from './AttemptSink';

/** How many rows the table sent to a student shows. */
const TOP = 5;

/**
 * Optimisation leaderboards (Phase 34.4). When a signed-in student solves a write question, its query
 * has been priced (rows it is estimated to scan, and its length); this keeps their best per question
 * and tells them where it puts them in their class and in the game. Only the numbers are kept, never
 * the query.
 * Pattern: Observer (an AttemptSink) — Why: grading reports what happened to an interface, so the
 * leaderboard is one more listener and grading never knows it exists.
 */
export class OptimisationSink implements AttemptSink {
  constructor(
    private readonly store: LeaderboardStore,
    private readonly nameOf: (accountId: number) => Promise<string | undefined>,
    private readonly deliver: (accountId: number, message: LeaderboardMessage) => void,
    private readonly log: (message: string, err: unknown) => void,
  ) {}

  event(_event: AttemptEvent): void {}

  item(item: ItemRecord, _who: AttemptWho): void {
    if (
      item.outcome !== 'solved' ||
      !item.cost ||
      item.accountId === undefined ||
      item.tutorial ||
      item.assessment
    )
      return;
    void this.record(item, item.accountId, item.cost).catch((err: unknown) =>
      this.log('could not update the leaderboard', err),
    );
  }

  private async record(
    item: ItemRecord,
    accountId: number,
    cost: NonNullable<ItemRecord['cost']>,
  ): Promise<void> {
    const name = (await this.nameOf(accountId)) ?? 'Student';
    const classId = item.classId ?? null;
    const newBest = await this.store.record(accountId, name, classId, item.questionId, cost);
    const summary = (view: BoardView | undefined): BoardSummary | undefined =>
      view && {
        rank: view.rank,
        of: view.of,
        top: view.top.map((r) => ({
          rank: r.rank,
          name: r.name,
          scanned: r.scanned,
          length: r.length,
          you: r.playerId === accountId,
        })),
      };
    const global = summary(await this.store.board(item.questionId, accountId, {}, TOP));
    const inClass =
      classId === null
        ? undefined
        : summary(await this.store.board(item.questionId, accountId, { classId }, TOP));
    if (!global) return;
    this.deliver(accountId, {
      t: 'leaderboard',
      question: item.review?.title ?? 'this question',
      you: cost,
      newBest,
      global,
      ...(inClass ? { class: inClass } : {}),
    });
  }
}
