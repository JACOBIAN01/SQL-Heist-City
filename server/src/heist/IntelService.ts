import {
  CITY_TABLES,
  intelSecondsFor,
  publicRequests,
  type CityDbMessage,
  type CityDbSettings,
  type CityQueryMessage,
  type CityRequest,
  type CityResultMessage,
  type IntelPinsMessage,
} from '@heist/shared';
import type { Player } from '../game/Player';
import { FeedbackBuilder } from '../sql/FeedbackBuilder';
import { ResultComparator } from '../sql/ResultComparator';
import type { JobOutcome, SandboxJob, SandboxRunner } from '../sql/SandboxRunner';
import type { QueryResult } from '../sql/SqlSandbox';
import type { CityDb } from './CityDb';
import type { MatchApi } from './MatchApi';

/** What a right query does in the world; the heist implements these. */
export interface IntelEffects {
  /** A bank's cameras go off and its guards go blind for `seconds`. */
  switchOff(bank: string, seconds: number): void;
  /** The door controller opens the vault's next lock for this player; false if there was nothing to open. */
  unlockNext(player: Player, bank: string): boolean;
}

/** What the intel service needs from the SQL system. */
export interface CitySql {
  run: SandboxRunner['run'];
  settings(): CityDbSettings;
}

interface Pin {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly label?: string;
  readonly expiresTick: number;
}

const MAX_ROWS = 200;
/** A wrong or failed try still costs this long (s) before the next one: no hammering. */
const TRY_GAP_SECONDS = 2;
const policy = { orderMatters: false, compareNames: false, caseSensitive: true } as const;
const feedbackFor = new FeedbackBuilder();

/**
 * Queries as superpowers (Phase 33). A student reads the city's live tables by writing SQL: a query
 * that answers a request correctly puts its rows on their map for a while, and a correct UPDATE
 * switches off a bank's cameras or opens a vault door. Correct means "gives the same rows (or the
 * same changed table) as the request's own answer, run on the same snapshot": the answer stays on the
 * server, the student's SQL runs in the sandbox on a throwaway copy, and what the world does about
 * it is decided here, under cooldowns and a range.
 * Pattern: Facade — Why: one place turns "a student asked a question" into a graded query, an effect
 * and a reply, over pieces (database, sandbox, comparator, effects) that know nothing of each other.
 */
export class IntelService {
  private readonly pins = new Map<Player, Pin[]>();
  private readonly lastAsk = new Map<string, number>();
  private readonly lastTry = new Map<Player, number>();
  private readonly busy = new Set<Player>();
  private told = new Map<Player, string>();
  private nextPin = 1;

  constructor(
    private readonly match: MatchApi,
    private readonly sql: () => CitySql | undefined,
    private readonly db: CityDb,
    private readonly effects: IntelEffects,
    private readonly active: () => boolean,
  ) {}

  /** What a student is shown: the tables and the requests (never the answers). */
  catalog(): CityDbMessage {
    const s = this.sql()?.settings();
    return {
      t: 'citydb',
      tables: CITY_TABLES,
      requests: s?.enabled ? publicRequests(s.requests.filter((r) => r.tier <= s.maxTier)) : [],
    };
  }

  forget(player: Player): void {
    this.pins.delete(player);
    this.told.delete(player);
    this.busy.delete(player);
    this.lastTry.delete(player);
    for (const key of [...this.lastAsk.keys()])
      if (key.startsWith(`${player.id}:`)) this.lastAsk.delete(key);
  }

  /** A new round: no intel carries over. */
  reset(): void {
    this.pins.clear();
    this.told.clear();
    this.lastAsk.clear();
  }

  /** Every tick or so: intel that ran out leaves the map. */
  onTick(): void {
    if (this.match.tick % 10 !== 0) return;
    for (const player of [...this.pins.keys()]) this.send(player);
  }

  /** Pins a player has now (for tests). */
  pinsOf(player: Player): readonly Pin[] {
    const now = this.match.tick;
    return (this.pins.get(player) ?? []).filter((p) => p.expiresTick > now);
  }

  // --- asking -------------------------------------------------------------------------------------

  async ask(player: Player, message: CityQueryMessage): Promise<CityResultMessage> {
    const base = { t: 'city_result', ref: message.ref, request: message.request } as const;
    const refuse = (
      reason: NonNullable<CityResultMessage['reason']>,
      extra: Partial<CityResultMessage> = {},
    ): CityResultMessage => ({ ...base, ok: false, reason, ...extra });
    const city = this.sql();
    const s = city?.settings();
    if (!city || !s?.enabled || !this.active()) return refuse('not_available');
    if (!player.alive) return refuse('dead');
    const request = s.requests.find((r) => r.id === message.request && r.tier <= s.maxTier);
    if (!request) return refuse('unknown');
    if (this.busy.has(player)) return refuse('busy');
    const now = this.match.tick / this.match.tickRate;
    const tried = this.lastTry.get(player);
    if (tried !== undefined && now - tried < TRY_GAP_SECONDS)
      return refuse('cooldown', { waitSeconds: Math.ceil(TRY_GAP_SECONDS - (now - tried)) });
    const key = `${player.id}:${request.id}`;
    const cooldown = s.cooldownSeconds[request.kind];
    const asked = this.lastAsk.get(key);
    if (asked !== undefined && now - asked < cooldown)
      return refuse('cooldown', { waitSeconds: Math.ceil(cooldown - (now - asked)) });
    this.lastTry.set(player, now);
    this.busy.add(player);
    try {
      const reply =
        request.kind === 'intel'
          ? await this.askIntel(player, request, message, s, city.run)
          : await this.askHack(player, request, message, s, city.run);
      if (reply.ok) this.lastAsk.set(key, now);
      return reply;
    } finally {
      this.busy.delete(player);
    }
  }

  private async askIntel(
    player: Player,
    request: CityRequest,
    message: CityQueryMessage,
    s: CityDbSettings,
    run: SandboxRunner['run'],
  ): Promise<CityResultMessage> {
    const base = { t: 'city_result', ref: message.ref, request: request.id } as const;
    const outcome = await run({
      data: this.db.snapshot(),
      queries: [
        { sql: message.sql, maxRows: MAX_ROWS },
        { sql: request.reference, maxRows: MAX_ROWS },
      ],
    });
    const checked = this.check(outcome, 2);
    if (checked.failed) return { ...base, ok: false, ...checked.failed };
    const [student, expected] = checked.results as [QueryResult, QueryResult];
    const compared = new ResultComparator(policy).compare(expected, student);
    if (!compared.match)
      return {
        ...base,
        ok: false,
        reason: 'wrong',
        feedback: feedbackFor.fromMismatch(compared.mismatch, student.columns),
      };
    const pins = this.pinsFrom(expected, player, s, intelSecondsFor(request.tier, s));
    this.addPins(player, pins, s.maxPins);
    this.send(player, true);
    return {
      ...base,
      ok: true,
      result: { kind: 'intel', pins: pins.length, seconds: intelSecondsFor(request.tier, s) },
    };
  }

  /** A write request: the student's UPDATE must leave the table as the request's own does. */
  private async askHack(
    player: Player,
    request: CityRequest,
    message: CityQueryMessage,
    s: CityDbSettings,
    run: SandboxRunner['run'],
  ): Promise<CityResultMessage> {
    const base = { t: 'city_result', ref: message.ref, request: request.id } as const;
    const table = request.kind === 'camera' ? 'cameras' : 'doors';
    const column = request.kind === 'camera' ? 'enabled' : 'locked';
    const data = this.db.snapshot();
    const readback: SandboxJob['queries'][number] = {
      sql: `SELECT id, ${column} FROM ${table} ORDER BY id`,
      maxRows: MAX_ROWS,
    };
    const [student, expected, before] = await Promise.all([
      run({ data, queries: [{ sql: message.sql, mode: 'write' }, readback] }),
      run({ data, queries: [{ sql: request.reference, mode: 'write' }, readback] }),
      run({ data, queries: [readback] }),
    ]);
    const mine = this.check(student, 2);
    if (mine.failed) return { ...base, ok: false, ...mine.failed };
    const theirs = this.check(expected, 2);
    const original = this.check(before, 1);
    if (theirs.failed || original.failed)
      return {
        ...base,
        ok: false,
        reason: 'error',
        feedback: { code: 'setup', message: 'The city database could not be set up.' },
      };
    const after = mine.results[1] as QueryResult;
    const compared = new ResultComparator({ ...policy, orderMatters: true }).compare(
      theirs.results[1] as QueryResult,
      after,
    );
    if (!compared.match)
      return {
        ...base,
        ok: false,
        reason: 'wrong',
        feedback: feedbackFor.fromMismatch(compared.mismatch, after.columns),
      };
    // What changed: the banks whose cameras went from on to off, or whose door went from locked to open.
    const was = new Map((original.results[0] as QueryResult).rows.map((r) => [String(r[0]), r[1]]));
    const changed = after.rows
      .filter((r) => was.get(String(r[0])) === 1 && r[1] === 0)
      .map((r) => String(r[0]));
    const banks = [
      ...new Set(
        changed.map((id) => (table === 'cameras' ? id.split(':')[0] : id.split(':')[0]) ?? ''),
      ),
    ];
    if (changed.length === 0 || banks.length === 0)
      return {
        ...base,
        ok: false,
        reason: 'wrong',
        feedback: { code: 'no_change', message: 'That did not change anything.' },
      };
    if (request.kind === 'camera') {
      for (const bank of banks) this.effects.switchOff(bank, s.cameraSeconds);
      return {
        ...base,
        ok: true,
        result: { kind: 'camera', seconds: s.cameraSeconds, effect: banks.join(', ') },
      };
    }
    const opened = banks.filter((bank) => this.effects.unlockNext(player, bank));
    if (opened.length === 0)
      return {
        ...base,
        ok: false,
        reason: 'not_available',
        feedback: { code: 'nothing_to_open', message: 'There is nothing left to unlock there.' },
      };
    return { ...base, ok: true, result: { kind: 'door', effect: opened.join(', ') } };
  }

  /** The results of a job, or why it failed. */
  private check(
    outcome: JobOutcome,
    count: number,
  ):
    | { failed: Pick<CityResultMessage, 'reason' | 'feedback'>; results: never[] }
    | { failed: undefined; results: QueryResult[] } {
    if (!outcome.ok)
      return {
        failed: {
          reason: 'error',
          feedback: feedbackFor.timeout(),
        },
        results: [],
      };
    const results: QueryResult[] = [];
    for (const [i, o] of outcome.outcomes.entries()) {
      if (!o.ok) {
        // The first query is the student's; any other failing is ours.
        return {
          failed: {
            reason: 'error',
            feedback: feedbackFor.fromSandboxError(o.code, o.message),
          },
          results: [],
        };
      }
      results.push(o.result);
      void i;
    }
    return results.length >= count
      ? { failed: undefined, results }
      : { failed: { reason: 'error' }, results: [] };
  }

  // --- the map ----------------------------------------------------------------------------------

  /** Pins from a right answer: the x and z columns, labelled by the first other column, within range. */
  private pinsFrom(result: QueryResult, player: Player, s: CityDbSettings, seconds: number): Pin[] {
    const names = result.columns.map((c) => c.toLowerCase());
    const xi = names.indexOf('x');
    const zi = names.indexOf('z');
    if (xi < 0 || zi < 0) return [];
    const label = names.findIndex((_, i) => i !== xi && i !== zi);
    const expires = this.match.tick + Math.round(seconds * this.match.tickRate);
    const out: Pin[] = [];
    for (const row of result.rows) {
      const x = Number(row[xi]);
      const z = Number(row[zi]);
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      if (Math.hypot(x - player.body.x, z - player.body.z) > s.rangeMeters) continue;
      const text = label >= 0 ? String(row[label] ?? '') : '';
      out.push({
        id: this.nextPin++,
        x,
        z,
        ...(text ? { label: text.slice(0, 24) } : {}),
        expiresTick: expires,
      });
    }
    return out;
  }

  private addPins(player: Player, pins: Pin[], max: number): void {
    const now = this.match.tick;
    const kept = (this.pins.get(player) ?? []).filter((p) => p.expiresTick > now);
    this.pins.set(player, [...kept, ...pins].slice(-max));
  }

  private send(player: Player, force = false): void {
    const live = this.pinsOf(player);
    const key = live.map((p) => p.id).join(',');
    if (!force && this.told.get(player) === key) return;
    this.told.set(player, key);
    if (live.length === 0) this.pins.delete(player);
    const message: IntelPinsMessage = {
      t: 'intel_pins',
      pins: live.map((p) => ({
        id: p.id,
        x: p.x,
        z: p.z,
        ...(p.label ? { label: p.label } : {}),
        secondsLeft: Math.max(
          0,
          Math.round((p.expiresTick - this.match.tick) / this.match.tickRate),
        ),
      })),
    };
    this.match.sendJson(player, message);
  }
}
