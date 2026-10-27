import {
  DEFAULT_STORY_SETTINGS,
  type JobKind,
  type StoryChain,
  type StoryMessage,
  type StorySettings,
} from '@heist/shared';
import type { Player } from '../game/Player';
import type { StoryStore } from '../progress/StoryStore';
import type { HeistEvents } from './HeistEvents';
import type { MatchApi } from './MatchApi';

/** Squad-mates this close (m) to a finished heist share its credit. */
const TOGETHER = 60;

/** What a step asks for, as an event describes it. */
type Happening =
  | { type: 'intel'; bank: string; level: number }
  | { type: 'job'; kind: JobKind }
  | { type: 'heist'; bank: string };

/**
 * The story (Phase 32.2): one chain of steps for each bank, in order, each using only what the game
 * already does (gather intel, finish a contract, crack and bank a vault). It follows the match's
 * events, so the heist rules know nothing of it. Finishing a chain pays cash and XP and gives a page
 * of the evidence; the next chain opens. A student's progress is kept with their account.
 * Pattern: Observer — Why: the story listens to what already happens, so it adds no coupling to the
 * systems it is about.
 */
export class StorySystem {
  private store: StoryStore | undefined;
  private settings: () => StorySettings = () => DEFAULT_STORY_SETTINGS;
  /** Steps finished in each chain, by bank; absent until loaded. */
  private readonly steps = new Map<Player, Record<string, number>>();
  private readonly loading = new Set<Player>();

  constructor(
    private readonly match: MatchApi,
    events: HeistEvents,
    /** Pays cash into the carried purse. */
    private readonly pay: (player: Player, amount: number) => void,
    private readonly active: () => boolean,
  ) {
    events.subscribe((e) => {
      if (!this.enabled()) return;
      if (e.type === 'intel_gained')
        this.happened(e.player, { type: 'intel', bank: e.bank, level: e.level });
      else if (e.type === 'job_done')
        this.happened(e.player, { type: 'job', kind: e.kind as JobKind });
      else if (e.type === 'heist_complete') {
        this.happened(e.player, { type: 'heist', bank: e.bank });
        this.shareWithSquad(e.player, e.bank);
      }
    });
  }

  bindStore(store: StoryStore): void {
    this.store = store;
  }

  bindSettings(settings: () => StorySettings): void {
    this.settings = settings;
  }

  private enabled(): boolean {
    return this.settings().enabled && this.active();
  }

  /** Steps finished in a bank's chain (for tests). */
  stepsOf(player: Player, bank: string): number {
    return this.steps.get(player)?.[bank] ?? 0;
  }

  forget(player: Player): void {
    this.steps.delete(player);
    this.loading.delete(player);
  }

  /** Reads a signed-in student's progress (a guest starts fresh) and tells them where they are. */
  load(player: Player): void {
    if (!this.enabled() || this.steps.has(player) || this.loading.has(player)) return;
    const store = this.store;
    if (!store || player.accountId === undefined) {
      this.steps.set(player, {});
      this.send(player);
      this.onLoaded?.(player);
      return;
    }
    this.loading.add(player);
    void store
      .steps(player.accountId)
      .then((s) => this.steps.set(player, { ...s }))
      .catch(() => this.steps.set(player, {}))
      .finally(() => {
        this.loading.delete(player);
        this.send(player);
        this.onLoaded?.(player);
      });
  }

  /** The story's words and chains as they stand now. */
  current(): StorySettings {
    return this.settings();
  }

  /** The chain a student is on: the first they have not finished. */
  chainOf(player: Player): StoryChain | undefined {
    return this.settings().chains.find((c) => this.stepsOf(player, c.bank) < c.steps.length);
  }

  /** Told once a student's progress has been read (the opening scene hangs off this). */
  onLoaded: ((player: Player) => void) | undefined;

  private happened(player: Player, what: Happening): void {
    if (!this.steps.has(player)) return; // still loading: not counted
    const chain = this.chainOf(player);
    if (!chain) return;
    const step = chain.steps[this.stepsOf(player, chain.bank)];
    if (!step) return;
    const need = step.need;
    const met =
      (need.type === 'intel' &&
        what.type === 'intel' &&
        what.bank === chain.bank &&
        what.level >= need.level) ||
      (need.type === 'job' && what.type === 'job' && (!need.kind || need.kind === what.kind)) ||
      (need.type === 'heist' && what.type === 'heist' && what.bank === chain.bank);
    if (met) this.advance(player, chain);
  }

  private advance(player: Player, chain: StoryChain): void {
    const mine = this.steps.get(player);
    if (!mine) return;
    const next = (mine[chain.bank] ?? 0) + 1;
    mine[chain.bank] = next;
    if (this.store && player.accountId !== undefined)
      void this.store.setStep(player.accountId, chain.bank, next).catch(() => {});
    const finished = next >= chain.steps.length;
    if (finished) {
      this.pay(player, chain.reward.cash);
      this.match.sendJson(player, {
        t: 'notice',
        text: `${chain.name}: finished. +$${chain.reward.cash.toLocaleString('en-US')}`,
      });
      this.onChainDone?.(player, chain);
    }
    this.send(player, finished ? chain.bank : undefined);
    this.onStep?.(player, chain, next);
  }

  /** Told when a chain is finished (the XP and the closing scene hang off this). */
  onChainDone: ((player: Player, chain: StoryChain) => void) | undefined;
  /** Told after every step (the scenes and barks hang off this). */
  onStep: ((player: Player, chain: StoryChain, stepsDone: number) => void) | undefined;

  /** Squad-mates standing near a finished heist share its credit. */
  private shareWithSquad(player: Player, bank: string): void {
    if (player.squad <= 0) return;
    for (const mate of this.match.playerList()) {
      if (mate === player || mate.squad !== player.squad || !mate.alive || mate.isGuard) continue;
      if (Math.hypot(mate.body.x - player.body.x, mate.body.z - player.body.z) > TOGETHER) continue;
      this.happened(mate, { type: 'heist', bank });
    }
  }

  /** How the story stands for a student. */
  view(player: Player, finished?: string): StoryMessage {
    const chains = this.settings().chains;
    const current = this.chainOf(player);
    return {
      t: 'story',
      chains: chains.map((c) => {
        const done = this.stepsOf(player, c.bank);
        const state = done >= c.steps.length ? 'done' : c === current ? 'active' : 'locked';
        const step = c.steps[done];
        return {
          bank: c.bank,
          name: c.name,
          fixer: c.fixer,
          state,
          step: done,
          total: c.steps.length,
          ...(state === 'active' && step
            ? { current: { title: step.title, text: step.text } }
            : {}),
          ...(state === 'done' ? { page: c.page } : {}),
        };
      }),
      pages: chains.filter((c) => this.stepsOf(player, c.bank) >= c.steps.length).length,
      ...(finished ? { finished } : {}),
    };
  }

  private send(player: Player, finished?: string): void {
    this.match.sendJson(player, this.view(player, finished));
  }
}
