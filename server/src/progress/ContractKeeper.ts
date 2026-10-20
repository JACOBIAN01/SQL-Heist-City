import {
  advanceContracts,
  contractViews,
  contractXp,
  dayOf,
  dealContracts,
  streakAfterFinishing,
  streakOn,
  type ContractState,
  type ContractsMessage,
  type ItemRecord,
  type ProgressionSettings,
} from '@heist/shared';
import type { AttemptEvent, AttemptSink, AttemptWho } from '../analytics/AttemptSink';
import type { ContractStore } from './ContractStore';

/**
 * Daily contracts (Phase 26.5): three short SQL jobs a day, filled as the student's questions end.
 * Finishing one pays XP, with a bonus for each day in a row that the student finished any.
 *
 * Pattern: Observer (an AttemptSink) — Why: grading is untouched; contracts are one more listener
 * on "a question ended", like XP and the learning profile.
 */
export class ContractKeeper implements AttemptSink {
  private readonly chains = new Map<number, Promise<void>>();
  /** The day old contracts were last cleared, so it happens once a day, whoever plays first. */
  private prunedOn = '';

  constructor(
    private readonly store: ContractStore,
    private readonly settings: () => ProgressionSettings,
    private readonly now: () => number,
    /** Pays XP for a finished contract. */
    private readonly pay: (accountId: number, xp: number) => Promise<void>,
    private readonly deliver: (accountId: number, message: ContractsMessage) => void,
    private readonly onError: (err: unknown) => void = () => {},
  ) {}

  event(_event: AttemptEvent): void {}

  item(item: ItemRecord, who: AttemptWho): void {
    const accountId = item.accountId ?? who.accountId;
    if (accountId === undefined) return;
    this.enqueue(accountId, async () => {
      const settings = this.settings();
      const day = dayOf(this.now());
      const dealt = await this.today(accountId, day, settings);
      const { state, completed } = advanceContracts(dealt, item, settings);
      if (state.every((c, i) => c === dealt[i])) return; // nothing moved
      await this.store.putDay(accountId, day, state);
      let streak = await this.store.getStreak(accountId);
      if (completed.length > 0) {
        streak = streakAfterFinishing(streak, day);
        await this.store.putStreak(accountId, streak);
        for (const id of completed) {
          const template = settings.contracts.templates.find((t) => t.id === id);
          if (template) await this.pay(accountId, contractXp(template, streak.days, settings));
        }
      }
      this.deliver(accountId, this.view(day, state, streak, settings, completed));
    });
  }

  /** Today's contracts for a student, dealt on first look. */
  async messageOf(accountId: number): Promise<ContractsMessage> {
    const settings = this.settings();
    const day = dayOf(this.now());
    const state = await this.today(accountId, day, settings);
    return this.view(day, state, await this.store.getStreak(accountId), settings);
  }

  /** Resolves when every update so far has landed (tests, shutdown). */
  async settled(): Promise<void> {
    await Promise.all([...this.chains.values()]);
  }

  private async today(
    accountId: number,
    day: string,
    settings: ProgressionSettings,
  ): Promise<ContractState[]> {
    if (this.prunedOn !== day) {
      this.prunedOn = day;
      const keep = settings.contracts.keepDays * 86_400_000;
      await this.store.pruneBefore(dayOf(Date.parse(day) - keep));
    }
    const have = await this.store.getDay(accountId, day);
    if (have) return have;
    const dealt = dealContracts(day, accountId, settings);
    await this.store.putDay(accountId, day, dealt);
    return dealt;
  }

  private view(
    day: string,
    state: readonly ContractState[],
    streak: { days: number; lastDay: string },
    settings: ProgressionSettings,
    completed: readonly string[] = [],
  ): ContractsMessage {
    const days = streakOn(streak, day);
    const { streakBonusPerDay, streakCap } = settings.contracts;
    return {
      t: 'contracts',
      day,
      contracts: contractViews(state, settings),
      streak: {
        days,
        bonusPct: Math.round(streakBonusPerDay * Math.min(streakCap, Math.max(0, days - 1)) * 100),
      },
      ...(completed.length ? { completed } : {}),
    };
  }

  private enqueue(accountId: number, work: () => Promise<void>): void {
    const next = (this.chains.get(accountId) ?? Promise.resolve())
      .then(work)
      .catch((err: unknown) => this.onError(err));
    this.chains.set(accountId, next);
  }
}
