import type { ColumnSpec, Rng, TableSpec } from '@heist/shared';
import type { DatasetRegistry } from './datasets';
import { pickSource, randomDate, randomStepInt } from './values';

export type SqlValue = string | number | null;

export interface GeneratedTable {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly SqlValue[])[];
}

/** Tables in generation order (= data_gen key order, so fks resolve). */
export type GeneratedTables = ReadonlyMap<string, GeneratedTable>;

/** Produces one column's value per row. Stateful (serial counters, uniqueness). */
export interface ColumnGenerator {
  next(): SqlValue;
}

export interface GeneratorContext {
  readonly rng: Rng;
  readonly datasets: DatasetRegistry;
  /** Tables generated so far, for foreign keys. */
  readonly tables: GeneratedTables;
}

type BuilderFor<K extends ColumnSpec['kind']> = (
  spec: Extract<ColumnSpec, { kind: K }>,
  ctx: GeneratorContext,
) => ColumnGenerator;

export class DataGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataGenerationError';
  }
}

// Pattern: Factory (registry) — Why: question JSON says `{ "kind": "pick" }`;
// the factory turns that into a generator without a switch in callers. New
// kinds are added by registering one builder (Open/Closed), and the mapped
// type makes a missing builder a compile error.
const builders: { [K in ColumnSpec['kind']]: BuilderFor<K> } = {
  serial: (spec) => {
    let n = spec.start;
    return { next: () => n++ };
  },
  pick: (spec, { rng, datasets }) => {
    const values = pickSource(spec.from, datasets);
    const weights = spec.weights;
    return {
      next: () => (weights ? rng.weightedPick(values, weights) : rng.pick(values)),
    };
  },
  int: (spec, { rng }) => ({ next: () => randomStepInt(rng, spec.min, spec.max, spec.step) }),
  real: (spec, { rng }) => {
    const factor = 10 ** spec.decimals;
    return {
      next: () => Math.round((spec.min + rng.next() * (spec.max - spec.min)) * factor) / factor,
    };
  },
  date: (spec, { rng }) => ({ next: () => randomDate(rng, spec.from, spec.to) }),
  bool: (spec, { rng }) => ({ next: () => (rng.bool(spec.p) ? 1 : 0) }),
  text_pattern: (spec, { rng }) => {
    const used = new Set<string>();
    const render = (): string =>
      spec.pattern.replace(/[#@]/g, (c) =>
        c === '#' ? String(rng.int(0, 9)) : String.fromCharCode(65 + rng.int(0, 25)),
      );
    return {
      next: () => {
        if (!spec.unique) return render();
        for (let attempt = 0; attempt < 1000; attempt++) {
          const value = render();
          if (!used.has(value)) {
            used.add(value);
            return value;
          }
        }
        throw new DataGenerationError(`pattern "${spec.pattern}" ran out of unique values`);
      },
    };
  },
  fk: (spec, { rng, tables }) => {
    const target = tables.get(spec.table);
    const index = target?.columns.indexOf(spec.column) ?? -1;
    if (!target || index < 0) {
      throw new DataGenerationError(`fk target ${spec.table}.${spec.column} was not generated`);
    }
    const values = target.rows.map((r) => r[index] as SqlValue).filter((v) => v !== null);
    return { next: () => (values.length === 0 ? null : rng.pick(values)) };
  },
  const: (spec) => ({ next: () => spec.value }),
  // Hierarchies (org charts, chains of command): each row's parent is an
  // earlier row's id, so the result is always a forest — perfect for
  // recursive CTE questions.
  tree_parent: (spec, { rng }) => {
    let index = 0;
    return {
      next: () => {
        const i = index++;
        return i < spec.roots ? null : spec.start + rng.int(0, i - 1);
      },
    };
  },
};

export function createColumnGenerator(spec: ColumnSpec, ctx: GeneratorContext): ColumnGenerator {
  const build = builders[spec.kind] as BuilderFor<typeof spec.kind>;
  const inner = build(spec as never, ctx);
  const nullRate = 'null_rate' in spec ? (spec.null_rate ?? 0) : 0;
  return nullRate > 0 ? withNulls(inner, nullRate, ctx.rng.fork('nulls')) : inner;
}

// Pattern: Decorator — Why: "sometimes NULL" applies to every kind; wrapping
// keeps that rule in one place instead of in each builder.
function withNulls(inner: ColumnGenerator, rate: number, rng: Rng): ColumnGenerator {
  return {
    next: () => {
      // Always advance the inner generator so serials/unique values stay aligned.
      const value = inner.next();
      return rng.bool(rate) ? null : value;
    },
  };
}

/** Generates every table of a question's data_gen for one seed. */
export function generateTables(
  dataGen: Readonly<Record<string, TableSpec>>,
  rng: Rng,
  datasets: DatasetRegistry,
): GeneratedTables {
  const tables = new Map<string, GeneratedTable>();
  for (const [table, spec] of Object.entries(dataGen)) {
    const tableRng = rng.fork(`table:${table}`);
    const rowCount = Array.isArray(spec.rows)
      ? tableRng.fork('rows').int(spec.rows[0], spec.rows[1])
      : spec.rows;
    const columns = Object.keys(spec.columns);
    const generators = Object.entries(spec.columns).map(([column, colSpec]) =>
      createColumnGenerator(colSpec, { rng: tableRng.fork(`col:${column}`), datasets, tables }),
    );
    const rows: SqlValue[][] = [];
    for (let i = 0; i < rowCount; i++) rows.push(generators.map((g) => g.next()));
    tables.set(table, { columns, rows });
  }
  return tables;
}
