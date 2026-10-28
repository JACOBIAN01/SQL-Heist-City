import {
  assembleSplit,
  publicSplits,
  type CityDbSettings,
  type CityResultMessage,
  type PublicSplitRequest,
  type SplitRequest,
  type SplitStateMessage,
  type SplitSubmitMessage,
} from '@heist/shared';
import type { Player } from '../game/Player';
import { FeedbackBuilder } from '../sql/FeedbackBuilder';
import { ResultComparator } from '../sql/ResultComparator';
import type { SandboxData } from '../sql/SqlSandbox';
import type { QueryResult } from '../sql/SqlSandbox';
import type { CityDb } from './CityDb';
import type { CitySql } from './IntelService';
import type { MatchApi } from './MatchApi';

interface Session {
  readonly split: SplitRequest;
  readonly data: SandboxData;
  readonly startedTick: number;
  readonly parts: ({ sql: string; by: Player } | undefined)[];
}

const MAX_ROWS = 200;
const feedbackFor = new FeedbackBuilder();
const parts = { orderMatters: false, compareNames: true, caseSensitive: true } as const;

/**
 * Co-op split queries (Phase 34.2). A squad faces one query in three parts and each member writes
 * one: two CTEs and the SELECT that joins them. Every part is graded alone (the last one against
 * the right CTEs), so a member can be right whatever the others write; when all three are in, the
 * assembled query is graded as a whole, and the squad's next vault lock opens and each of them is
 * paid. All of it runs on one snapshot, taken when the first part comes in.
 * Pattern: Template Method (grade a part, then the whole) — Why: the three parts and the whole are
 * graded the same way, so a new split is data and not a new class.
 */
export class SplitQueries {
  private readonly sessions = new Map<number, Session>();

  constructor(
    private readonly match: MatchApi,
    private readonly sql: () => CitySql | undefined,
    private readonly db: CityDb,
    private readonly effects: {
      unlockNext(player: Player, bank: string): boolean;
      pay(player: Player, amount: number): void;
    },
    private readonly active: () => boolean,
  ) {}

  catalog(): PublicSplitRequest[] {
    const s = this.sql()?.settings();
    return s?.enabled ? publicSplits(s.splits.filter((x) => x.tier <= s.maxTier)) : [];
  }

  /** A new round: no half-built queries carry over. */
  reset(): void {
    this.sessions.clear();
  }

  forget(player: Player): void {
    for (const [squad, session] of this.sessions)
      session.parts.forEach(
        (p, i) => {
          if (p?.by === player) session.parts[i] = undefined;
        },
        void squad,
      );
  }

  async submit(player: Player, message: SplitSubmitMessage): Promise<CityResultMessage> {
    const base = { t: 'city_result', ref: message.ref, request: message.split } as const;
    const refuse = (
      reason: NonNullable<CityResultMessage['reason']>,
      extra: Partial<CityResultMessage> = {},
    ): CityResultMessage => ({ ...base, ok: false, reason, ...extra });
    const city = this.sql();
    const s = city?.settings();
    if (!city || !s?.enabled || !this.active()) return refuse('not_available');
    if (!player.alive) return refuse('dead');
    if (player.squad <= 0) return refuse('squad');
    const split = s.splits.find((x) => x.id === message.split && x.tier <= s.maxTier);
    if (!split) return refuse('unknown');
    let session = this.sessions.get(player.squad);
    const now = this.match.tick;
    if (session && (session.split.id !== split.id || this.expired(session, s))) {
      this.sessions.delete(player.squad);
      session = undefined;
    }
    // One part each: a member who already holds another part cannot take a second.
    const held = session?.parts.findIndex((p) => p?.by === player);
    if (held !== undefined && held >= 0 && held !== message.part) return refuse('taken');
    const other = session?.parts[message.part];
    if (other && other.by !== player) return refuse('taken');
    session ??= {
      split,
      data: this.db.snapshot(),
      startedTick: now,
      parts: [undefined, undefined, undefined],
    };
    const graded = await this.gradePart(session, message.part, message.sql, city.run);
    if (graded.failed) return { ...base, ...graded.failed, ok: false };
    session.parts[message.part] = { sql: message.sql, by: player };
    this.sessions.set(player.squad, session);
    const done = session.parts.every((p) => p !== undefined);
    if (!done) {
      this.tell(player.squad, session);
      return {
        ...base,
        ok: true,
        result: { kind: 'intel', effect: `part ${message.part + 1} accepted` },
      };
    }
    // All three are right on their own: grade the query they make together.
    const whole = await this.gradeWhole(session, city.run);
    if (whole) {
      session.parts[message.part] = undefined;
      this.tell(player.squad, session);
      return { ...base, ok: false, ...whole };
    }
    this.sessions.delete(player.squad);
    const members = [...this.match.playerList()].filter((p) => p.squad === player.squad && p.alive);
    const opened = this.effects.unlockNext(player, split.bank);
    for (const m of members) this.effects.pay(m, s.splitReward);
    this.tell(player.squad, session, true);
    return {
      ...base,
      ok: true,
      result: {
        kind: 'door',
        effect: opened ? split.bank : `${split.bank} (nothing left to unlock)`,
      },
    };
  }

  private expired(session: Session, s: CityDbSettings): boolean {
    return this.match.tick - session.startedTick > s.splitWindowSeconds * this.match.tickRate;
  }

  /** One part on its own: the first two as queries, the last on top of the right CTEs. */
  private async gradePart(
    session: Session,
    index: number,
    sql: string,
    run: CitySql['run'],
  ): Promise<{ failed?: Pick<CityResultMessage, 'reason' | 'feedback'> }> {
    const { split } = session;
    const reference = split.parts[index]?.reference ?? '';
    const wrap = (body: string) =>
      index < 2
        ? body
        : assembleSplit(split, [split.parts[0].reference, split.parts[1].reference, body]);
    const outcome = await run({
      data: session.data,
      queries: [
        { sql: wrap(sql), maxRows: MAX_ROWS },
        { sql: wrap(reference), maxRows: MAX_ROWS },
      ],
    });
    if (!outcome.ok) return { failed: { reason: 'error', feedback: feedbackFor.timeout() } };
    const [mine, theirs] = outcome.outcomes;
    if (!mine?.ok)
      return {
        failed: {
          reason: 'error',
          feedback: feedbackFor.fromSandboxError(mine?.code ?? 'sql_error', mine?.message ?? ''),
        },
      };
    if (!theirs?.ok) return { failed: { reason: 'error' } };
    const compared = new ResultComparator({ ...parts, orderMatters: index === 2 }).compare(
      theirs.result,
      mine.result,
    );
    return compared.match
      ? {}
      : {
          failed: {
            reason: 'wrong',
            feedback: feedbackFor.fromMismatch(compared.mismatch, mine.result.columns),
          },
        };
  }

  /** The three parts put together, against the right three put together. */
  private async gradeWhole(
    session: Session,
    run: CitySql['run'],
  ): Promise<Pick<CityResultMessage, 'reason' | 'feedback'> | undefined> {
    const sqls = session.parts.map((p) => p?.sql ?? '') as [string, string, string];
    const refs = session.split.parts.map((p) => p.reference) as [string, string, string];
    const outcome = await run({
      data: session.data,
      queries: [
        { sql: assembleSplit(session.split, sqls), maxRows: MAX_ROWS },
        { sql: assembleSplit(session.split, refs), maxRows: MAX_ROWS },
      ],
    });
    if (!outcome.ok) return { reason: 'error', feedback: feedbackFor.timeout() };
    const [mine, theirs] = outcome.outcomes;
    if (!mine?.ok || !theirs?.ok) return { reason: 'error' };
    const compared = new ResultComparator({ ...parts, orderMatters: true }).compare(
      theirs.result as QueryResult,
      mine.result as QueryResult,
    );
    return compared.match
      ? undefined
      : {
          reason: 'wrong',
          feedback: feedbackFor.fromMismatch(compared.mismatch, mine.result.columns),
        };
  }

  /** Tells the whole squad where the query stands. */
  private tell(squad: number, session: Session, opened = false): void {
    const message: SplitStateMessage = {
      t: 'split_state',
      split: session.split.id,
      parts: session.parts.map((p) => (p ? { status: 'done', by: p.by.name } : { status: 'open' })),
      ...(opened ? { opened: true } : {}),
    };
    for (const p of this.match.playerList()) if (p.squad === squad) this.match.sendJson(p, message);
  }

  /** The state a squad's query is in (for tests). */
  stateOf(squad: number): readonly boolean[] | undefined {
    return this.sessions.get(squad)?.parts.map((p) => p !== undefined);
  }
}
