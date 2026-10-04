import type { HeistSettings } from '@heist/shared';
import type { Player } from '../game/Player';
import type { MatchApi } from './MatchApi';
import { rankPlayers, toStanding } from './Scoreboard';

export type RoundPhase = 'playing' | 'ended';

export interface RoundHooks {
  /** Every vault is open and no bag lies on the ground: nothing left to fight over. */
  allVaultsEmptied(): boolean;
  /** Put the world and every player back to the start of a round. */
  reset(): void;
  /** The round just ended: stop banking and the like. */
  onEnd(): void;
}

const TOP = 10;

/**
 * The round: a timer, an early finish once the vaults are emptied (after a
 * short overtime to bank), a winner by banked cash, an intermission, and a
 * fresh round. It also publishes the scoreboard. All times are in ticks, so
 * it runs on the match clock and is deterministic in tests.
 */
export class RoundController {
  phase: RoundPhase = 'playing';
  private startTick: number;
  private endTick: number;
  private nextRoundTick = 0;
  private overtimeArmed = false;
  private nextScoresTick = 0;

  constructor(
    private readonly match: MatchApi,
    private readonly settings: HeistSettings,
    private readonly hooks: RoundHooks,
  ) {
    this.startTick = match.tick;
    this.endTick = this.startTick + this.ticks(settings.roundMinutes * 60);
  }

  get over(): boolean {
    return this.phase === 'ended';
  }

  /** New players may join early in a round and between rounds, so nobody joins a race already decided. */
  canJoin(): boolean {
    return (
      this.over ||
      this.match.tick - this.startTick <= this.ticks(this.settings.joinWindowMinutes * 60)
    );
  }

  /** A new player: where the round stands and the current scores. */
  onJoin(player: Player): void {
    this.match.sendJson(player, this.roundMessage());
    this.sendScores(player);
  }

  onTick(): void {
    const tick = this.match.tick;
    if (this.phase === 'playing') {
      if (!this.overtimeArmed && this.hooks.allVaultsEmptied()) {
        this.overtimeArmed = true;
        this.endTick = Math.min(this.endTick, tick + this.ticks(this.settings.overtimeSeconds));
        this.match.broadcastJson(this.roundMessage());
      }
      if (tick >= this.endTick) this.end();
    } else if (tick >= this.nextRoundTick) {
      this.start();
    }
    if (tick >= this.nextScoresTick) {
      this.nextScoresTick = tick + this.ticks(this.settings.scoreboardEverySec);
      this.publishScores();
    }
  }

  private start(): void {
    this.hooks.reset();
    this.phase = 'playing';
    this.overtimeArmed = false;
    this.startTick = this.match.tick;
    this.endTick = this.startTick + this.ticks(this.settings.roundMinutes * 60);
    this.match.broadcastJson(this.roundMessage());
    this.publishScores();
  }

  private end(): void {
    this.phase = 'ended';
    this.nextRoundTick = this.match.tick + this.ticks(this.settings.intermissionSeconds);
    this.hooks.onEnd();
    this.match.broadcastJson(this.roundMessage());
    this.publishScores();
  }

  private roundMessage() {
    if (this.phase === 'playing') {
      return {
        t: 'round' as const,
        phase: 'playing' as const,
        endsInSec: Math.max(0, Math.ceil((this.endTick - this.match.tick) / this.match.tickRate)),
      };
    }
    const ranked = rankPlayers(this.match.playerList());
    const first = ranked[0];
    return {
      t: 'round' as const,
      phase: 'ended' as const,
      nextInSec: Math.max(
        0,
        Math.ceil((this.nextRoundTick - this.match.tick) / this.match.tickRate),
      ),
      // Nobody banked anything: nobody won.
      winner: first && first.banked > 0 ? toStanding(first) : null,
      standings: ranked.slice(0, TOP).map(toStanding),
    };
  }

  /** The leaders to everyone, and each player their own rank when it changed. */
  private publishScores(): void {
    const ranked = rankPlayers(this.match.playerList());
    this.match.broadcastJson({
      t: 'scores',
      top: ranked.slice(0, TOP).map(toStanding),
      players: ranked.length,
    });
    ranked.forEach((p, i) => {
      if (p.rank === i + 1 && p.rankedOf === ranked.length) return;
      p.rank = i + 1;
      p.rankedOf = ranked.length;
      this.match.sendJson(p, { t: 'standing', rank: p.rank, players: ranked.length });
    });
  }

  private sendScores(player: Player): void {
    const ranked = rankPlayers(this.match.playerList());
    this.match.sendJson(player, {
      t: 'scores',
      top: ranked.slice(0, TOP).map(toStanding),
      players: ranked.length,
    });
    const rank = ranked.indexOf(player) + 1;
    if (rank > 0) {
      player.rank = rank;
      player.rankedOf = ranked.length;
      this.match.sendJson(player, { t: 'standing', rank, players: ranked.length });
    }
  }

  private ticks(seconds: number): number {
    return Math.round(seconds * this.match.tickRate);
  }
}
