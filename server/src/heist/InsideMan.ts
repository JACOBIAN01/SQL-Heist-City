import type { HeistSettings, RejectReason, Rng } from '@heist/shared';
import type { Player } from '../game/Player';
import type { HeistEvents } from './HeistEvents';
import type { MatchApi } from './MatchApi';
import type { TaskRule } from './TaskRule';

type Settings = HeistSettings['insideMan'];

interface Call {
  readonly bank: string;
  readonly endsTick: number;
}

const KEY = /^inside:(bank-[1-5])$/;

/**
 * The inside man (Phase 34.3). After you crack a lock he sometimes rings with a query of his own
 * that is broken, and asks you to fix it (a question of the "fix" kind, harder at higher banks).
 * Fixed in time he calms that bank's guards and tips you; left, the call lapses. A call is the
 * server's: the client is told, and only a call that is live can be answered.
 * Pattern: Observer + Strategy (TaskRule) — Why: he listens to cracked locks and plugs into the
 * reward registry, so the heist rules know nothing of him.
 */
export class InsideMan implements TaskRule {
  private readonly calls = new Map<Player, Call>();

  constructor(
    private readonly match: MatchApi,
    private readonly settings: () => Settings,
    events: HeistEvents,
    private readonly rng: Rng,
    private readonly effects: {
      calmGuards(bank: string): void;
      pay(player: Player, amount: number): void;
    },
    private readonly active: () => boolean,
  ) {
    events.subscribe((e) => {
      if (e.type !== 'lock_opened' || !e.player || !this.enabled()) return;
      // Not after the last lock: by then the vault is open and there is nothing to calm.
      if (e.vault.isOpen || this.calls.has(e.player)) return;
      if (this.rng.next() < this.settings().chance)
        this.ring(e.player, `bank-${e.vault.spec.tier}`);
    });
  }

  private enabled(): boolean {
    return this.settings().enabled && this.active();
  }

  /** The call a player has now, if any. */
  callOf(player: Player): Readonly<Call> | undefined {
    return this.calls.get(player);
  }

  /** He rings. */
  ring(player: Player, bank: string): void {
    const s = this.settings();
    this.calls.set(player, {
      bank,
      endsTick: this.match.tick + Math.round(s.seconds * this.match.tickRate),
    });
    this.match.sendJson(player, {
      t: 'inside',
      status: 'call',
      bank,
      text: this.rng.pick(s.lines),
      seconds: s.seconds,
    });
  }

  /** Calls that ran out are closed. */
  onTick(): void {
    if (this.match.tick % 10 !== 0) return;
    for (const [player, call] of [...this.calls]) {
      if (this.match.tick < call.endsTick && player.alive) continue;
      this.calls.delete(player);
      this.match.sendJson(player, {
        t: 'inside',
        status: 'missed',
        bank: call.bank,
        text: '',
        seconds: 0,
      });
    }
  }

  forget(player: Player): void {
    this.calls.delete(player);
  }

  reset(): void {
    this.calls.clear();
  }

  // --- the question (TaskRule) ----------------------------------------------------------------

  handles(rewardKey: string): boolean {
    return KEY.test(rewardKey);
  }

  check(player: Player, rewardKey: string): RejectReason | undefined {
    const bank = KEY.exec(rewardKey)?.[1];
    const call = this.calls.get(player);
    return call && call.bank === bank && this.match.tick < call.endsTick
      ? undefined
      : 'not_allowed';
  }

  grant(player: Player, rewardKey: string): void {
    const bank = KEY.exec(rewardKey)?.[1];
    const call = this.calls.get(player);
    if (!bank || !call || call.bank !== bank) return;
    this.calls.delete(player);
    this.effects.calmGuards(bank);
    this.effects.pay(player, this.settings().reward);
    this.match.sendJson(player, { t: 'inside', status: 'done', bank, text: '', seconds: 0 });
  }
}
