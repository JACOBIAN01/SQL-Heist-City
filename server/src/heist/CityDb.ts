import { CITY_SCHEMA_SQL } from '@heist/shared';
import type { SandboxData } from '../sql/SqlSandbox';
import type { GeneratedTables, SqlValue } from '../variants/dataGenerators';

/** What the city database mirrors; the heist implements it from the match's state. */
export interface CityState {
  guards(): readonly {
    id: number;
    bank: string;
    x: number;
    z: number;
    storey: number;
    alert: boolean;
  }[];
  cameras(): readonly { id: string; bank: string; x: number; z: number; enabled: boolean }[];
  cashDrops(): readonly { id: number; x: number; z: number; amount: number; loose: boolean }[];
  wanted(): readonly { id: number; name: string; cash: number; x: number; z: number }[];
  police(): readonly { id: number; target: number; x: number; z: number; role: string }[];
  banks(): readonly {
    id: string;
    name: string;
    tier: number;
    locks: number;
    opened: number;
    x: number;
    z: number;
  }[];
  doors(): readonly { id: string; bank: string; locked: boolean }[];
  /** The robbers' log (cops and robbers); empty otherwise. */
  trail(): readonly {
    id: number;
    robber: number;
    name: string;
    cash: number;
    x: number;
    z: number;
    ageS: number;
  }[];
}

const round = (n: number): number => Math.round(n * 10) / 10;

/**
 * The city database (Phase 33.1): tables that mirror the world right now. They are read from the
 * match's own state when a query is asked for, so nothing is kept in step every tick and the cost
 * is a few dozen rows per question. The sandbox that runs a student's query gets a fresh copy, so
 * nothing a student writes can touch the game.
 * Pattern: Adapter — Why: the heist's guards, police, bags and cameras each know themselves in
 * their own terms; this one place turns them into the rows a student sees.
 */
export class CityDb {
  constructor(private readonly state: CityState) {}

  snapshot(): SandboxData {
    const s = this.state;
    const num = (n: number): SqlValue => round(n);
    const tables: GeneratedTables = new Map([
      [
        'guards',
        {
          columns: ['id', 'bank', 'x', 'z', 'storey', 'alert'],
          rows: s
            .guards()
            .map((g) => [g.id, g.bank, num(g.x), num(g.z), g.storey, g.alert ? 1 : 0]),
        },
      ],
      [
        'cameras',
        {
          columns: ['id', 'bank', 'x', 'z', 'enabled'],
          rows: s.cameras().map((c) => [c.id, c.bank, num(c.x), num(c.z), c.enabled ? 1 : 0]),
        },
      ],
      [
        'cash_drops',
        {
          columns: ['id', 'x', 'z', 'amount', 'loose'],
          rows: s.cashDrops().map((d) => [d.id, num(d.x), num(d.z), d.amount, d.loose ? 1 : 0]),
        },
      ],
      [
        'wanted',
        {
          columns: ['id', 'name', 'cash', 'x', 'z'],
          rows: s.wanted().map((w) => [w.id, w.name, w.cash, num(w.x), num(w.z)]),
        },
      ],
      [
        'police',
        {
          columns: ['id', 'target', 'x', 'z', 'role'],
          rows: s.police().map((p) => [p.id, p.target, num(p.x), num(p.z), p.role]),
        },
      ],
      [
        'banks',
        {
          columns: ['id', 'name', 'tier', 'locks', 'opened', 'x', 'z'],
          rows: s.banks().map((b) => [b.id, b.name, b.tier, b.locks, b.opened, num(b.x), num(b.z)]),
        },
      ],
      [
        'trail',
        {
          columns: ['id', 'robber', 'name', 'cash', 'x', 'z', 'age_s'],
          rows: s.trail().map((t) => [t.id, t.robber, t.name, t.cash, num(t.x), num(t.z), t.ageS]),
        },
      ],
      [
        'doors',
        {
          columns: ['id', 'bank', 'locked'],
          rows: s.doors().map((d) => [d.id, d.bank, d.locked ? 1 : 0]),
        },
      ],
    ]);
    return { schemaSql: CITY_SCHEMA_SQL, tables };
  }
}
