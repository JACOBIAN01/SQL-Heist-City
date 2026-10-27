import type {
  ActsMessage,
  PayoutMessage,
  HeistSettings,
  InteractResult,
  MapAnchor,
  RejectReason,
} from '@heist/shared';
import type { Player } from '../game/Player';
import type { HeistEvents } from './HeistEvents';
import type { InteractionHandler } from './InteractionService';
import type { MatchApi } from './MatchApi';
import type { TaskRule } from './TaskRule';

type Settings = HeistSettings['acts'];
type Act = ActsMessage['act'];

interface Run {
  bank: string;
  act: Act;
  take: number;
  /** What the cash was made of, as far as this player's own work went (the payout screen). */
  parts?: { locks: number; ghost: number; intel: number };
}

const INTEL_KEY = /^intel:(bank-[1-5])$/;
/** A bag taken this close to a vault's loot spot is that vault's cash (m). */
const LOOT_NEAR = 12;

/**
 * A heist in three acts (Phase 31.1): setup (intel jobs at the terminal outside the bank), the
 * heist (the locks) and the getaway (carry the take to a safehouse). It watches the match's events
 * to know which act a player is in, and holds the intel they gathered. The intel's effects are read
 * by the systems they change through `alertScale`, `lootBonus` and `guardsToShow`.
 * Pattern: Observer + Strategy — Why: the heist rules publish what happened and know nothing of
 * acts; this follows along, and plugs into the interaction and reward registries.
 */
export class ActsSystem implements InteractionHandler, TaskRule {
  /** Intel points by player and bank. */
  private readonly intel = new Map<Player, Map<string, number>>();
  private readonly runs = new Map<Player, Run>();

  constructor(
    private readonly match: MatchApi,
    private readonly settings: () => Settings,
    private readonly events: HeistEvents,
    private readonly payout: () => HeistSettings['payout'],
    private readonly guardsAt: (bank: string) => readonly { x: number; z: number }[],
    private readonly active: () => boolean,
  ) {
    events.subscribe((e) => {
      if (!this.settings().enabled || !this.active()) return;
      if (e.type === 'lock_opened' && e.player) {
        this.start(e.player, `bank-${e.vault.spec.tier}`, 'heist');
        const run = this.runs.get(e.player);
        if (run) this.part(run).locks += e.bonus ?? 0;
      } else if (e.type === 'vault_opened' && e.by) {
        const run = this.runs.get(e.by);
        if (run) {
          this.part(run).ghost += e.ghostAmount ?? 0;
          this.part(run).intel += e.intelAmount ?? 0;
        }
      } else if (e.type === 'bag_taken') this.taken(e.player, e.x, e.z, e.amount);
      else if (e.type === 'banked') this.banked(e.player, e.amount);
    });
  }

  intelOf(player: Player, bank: string): number {
    return this.intel.get(player)?.get(bank) ?? 0;
  }

  runOf(player: Player): Readonly<Run> | undefined {
    return this.runs.get(player);
  }

  forget(player: Player): void {
    this.intel.delete(player);
    this.runs.delete(player);
  }

  /** A new round: every plan is dropped, intel and all. */
  reset(): void {
    this.intel.clear();
    this.runs.clear();
  }

  /** The player dies: the run ends, the intel they gathered stays for the round. */
  died(player: Player): void {
    const run = this.runs.get(player);
    if (!this.runs.delete(player)) return;
    this.send(player, undefined, 'none');
    // A getaway that never made it: the take is lost, and the screen says so.
    if (run?.act === 'getaway' && run.take > 0 && this.payout().enabled)
      this.match.sendJson(player, {
        t: 'payout',
        outcome: 'failed',
        bank: run.bank,
        total: run.take,
        lines: [{ id: 'lost', amount: run.take }],
        mastery: 0,
      } satisfies PayoutMessage);
    if (run?.act === 'getaway' && run.take > 0)
      this.events.publish({ type: 'heist_failed', player, bank: run.bank });
  }

  // --- act one: the terminal ------------------------------------------------------------------

  use(player: Player, anchor: MapAnchor): InteractResult {
    const s = this.settings();
    if (!s.enabled || !this.active() || !anchor.bank)
      return { action: 'denied', reason: 'not_available' };
    if (this.intelOf(player, anchor.bank) >= s.intelMax)
      return { action: 'denied', reason: 'intel_full' };
    return { action: 'open_task', rewardKey: `intel:${anchor.bank}`, target: anchor.bank };
  }

  handles(rewardKey: string): boolean {
    return INTEL_KEY.test(rewardKey);
  }

  check(player: Player, rewardKey: string): RejectReason | undefined {
    const bank = INTEL_KEY.exec(rewardKey)?.[1];
    if (!bank || !this.settings().enabled) return 'unknown_reward';
    return this.intelOf(player, bank) >= this.settings().intelMax ? 'not_allowed' : undefined;
  }

  grant(player: Player, rewardKey: string): void {
    const bank = INTEL_KEY.exec(rewardKey)?.[1];
    if (bank) this.grantIntel(player, bank);
  }

  /** One more intel point on a bank (from the terminal's question, or a recon contract). */
  grantIntel(player: Player, bank: string): void {
    if (!/^bank-[1-5]$/.test(bank)) return;
    const mine = this.intel.get(player) ?? new Map<string, number>();
    this.intel.set(player, mine);
    mine.set(bank, Math.min(this.settings().intelMax, (mine.get(bank) ?? 0) + 1));
    if (!this.runs.has(player)) this.runs.set(player, { bank, act: 'setup', take: 0 });
    const run = this.runs.get(player);
    if (run && run.bank !== bank && run.act === 'setup') run.bank = bank;
    this.send(player, run);
    this.events.publish({ type: 'intel_gained', player, bank, level: mine.get(bank) ?? 0 });
  }

  // --- what the intel does --------------------------------------------------------------------

  /** Guards stay on alert this share as long (intel level 2 and up). */
  alertScale(player: Player | undefined, bank: string): number {
    return player && this.intelOf(player, bank) >= 2 ? this.settings().alertScale : 1;
  }

  /** Extra share of the vault's cash (intel level 3). */
  lootBonus(player: Player | undefined, bank: string): number {
    return player && this.intelOf(player, bank) >= 3 ? this.settings().lootBonus : 0;
  }

  /** Every tick or so: tells players with intel where that bank's guards are. */
  onTick(): void {
    const s = this.settings();
    if (!s.enabled || !this.active() || this.match.tick % 10 !== 0) return;
    for (const [player, banks] of this.intel) {
      if (!player.alive) continue;
      const guards: { x: number; z: number }[] = [];
      for (const [bank, level] of banks) {
        if (level < 1) continue;
        for (const g of this.guardsAt(bank))
          if (Math.hypot(g.x - player.body.x, g.z - player.body.z) <= s.mapRange) guards.push(g);
      }
      this.match.sendJson(player, { t: 'intel_guards', guards });
    }
  }

  // --- acts two and three ---------------------------------------------------------------------

  private start(player: Player, bank: string, act: Act): void {
    const run = this.runs.get(player);
    if (run && run.bank === bank && (run.act === 'getaway' || run.act === 'heist')) return;
    this.runs.set(player, { bank, act, take: 0 });
    this.send(player, this.runs.get(player));
  }

  /** Picking up cash lying at a vault's loot spots starts the getaway with it. */
  private taken(player: Player, x: number, z: number, amount: number): void {
    const vault = (this.match.map.vaults ?? []).find((v) =>
      v.loot.some((l) => Math.hypot(l.x - x, l.z - z) <= LOOT_NEAR),
    );
    if (!vault) return;
    const bank = `bank-${vault.tier}`;
    const run = this.runs.get(player);
    // The heist's own record (what the cash was made of) carries on into the getaway.
    const carried = run && run.bank === bank ? run : undefined;
    const next: Run = {
      bank,
      act: 'getaway',
      take: (carried?.act === 'getaway' ? carried.take : 0) + amount,
      ...(carried?.parts ? { parts: carried.parts } : {}),
    };
    this.runs.set(player, next);
    this.send(player, next);
  }

  private part(run: Run): { locks: number; ghost: number; intel: number } {
    run.parts ??= { locks: 0, ghost: 0, intel: 0 };
    return run.parts;
  }

  /** Banking while on the getaway completes the heist. */
  private banked(player: Player, amount: number): void {
    const run = this.runs.get(player);
    if (!run || run.act !== 'getaway') return;
    this.runs.delete(player);
    const take = Math.min(run.take, amount);
    this.send(player, { ...run, take }, 'complete');
    const p = this.payout();
    if (!p.enabled) return;
    const tier = Number(run.bank.replace('bank-', '')) || 1;
    const parts = run.parts ?? { locks: 0, ghost: 0, intel: 0 };
    const mastery = tier * p.masteryXpPerTier + (parts.ghost > 0 ? p.ghostXp : 0);
    const lines: PayoutMessage['lines'][number][] = [
      { id: 'vault', amount: Math.max(0, take - parts.ghost - parts.intel) },
      ...(parts.ghost > 0 ? [{ id: 'ghost' as const, amount: parts.ghost }] : []),
      ...(parts.intel > 0 ? [{ id: 'intel' as const, amount: parts.intel }] : []),
      ...(parts.locks > 0 ? [{ id: 'locks' as const, amount: parts.locks }] : []),
    ];
    const rest = amount - lines.reduce((n, l) => n + l.amount, 0);
    if (rest > 0) lines.push({ id: 'other', amount: rest });
    this.match.sendJson(player, {
      t: 'payout',
      outcome: 'complete',
      bank: run.bank,
      total: amount,
      lines,
      mastery,
    } satisfies PayoutMessage);
    this.events.publish({ type: 'heist_complete', player, bank: run.bank, tier, mastery });
  }

  private send(player: Player, run: Run | undefined, act?: Act): void {
    const bank = run?.bank;
    const message: ActsMessage = {
      t: 'acts',
      ...(bank ? { bank } : {}),
      act: act ?? run?.act ?? 'none',
      intel: bank ? this.intelOf(player, bank) : 0,
      intelMax: this.settings().intelMax,
      take: run?.take ?? 0,
    };
    this.match.sendJson(player, message);
  }
}
