import pg from 'pg';

export interface PgOptions {
  readonly url: string;
  /** Schema to work in (tests use one each); default is the connection's own. */
  readonly schema?: string;
  readonly max?: number;
}

/** Rows of a query, typed by the caller. */
export type Row = Record<string, unknown>;

/**
 * One handle to PostgreSQL, shared by every repository.
 *
 * Pattern: Facade — Why: repositories speak `query` and `tx`, never the driver,
 * so the driver, pooling and transactions are decided in one place and tests
 * can point the same repositories at a throw-away schema.
 */
export class PgDatabase {
  private constructor(
    private readonly pool: pg.Pool,
    readonly schema: string | undefined,
  ) {}

  static open(options: PgOptions): PgDatabase {
    const pool = new pg.Pool({
      connectionString: options.url,
      max: options.max ?? 10,
      ...(options.schema ? { options: `-c search_path=${quoteIdent(options.schema)}` } : {}),
    });
    // An idle client dropped by the server must not crash the process.
    pool.on('error', () => {});
    return new PgDatabase(pool, options.schema);
  }

  async query<T extends Row = Row>(text: string, params: readonly unknown[] = []): Promise<T[]> {
    const result = await this.pool.query(text, params as unknown[]);
    return result.rows as T[];
  }

  /** The first row, or undefined. */
  async one<T extends Row = Row>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T | undefined> {
    return (await this.query<T>(text, params))[0];
  }

  /** Runs `work` in one transaction: committed if it returns, rolled back if it throws. */
  async tx<T>(work: (db: PgTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(new PgTx(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** The same query methods, inside a transaction. */
export class PgTx {
  constructor(private readonly client: pg.PoolClient) {}

  async query<T extends Row = Row>(text: string, params: readonly unknown[] = []): Promise<T[]> {
    return (await this.client.query(text, params as unknown[])).rows as T[];
  }

  async one<T extends Row = Row>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T | undefined> {
    return (await this.query<T>(text, params))[0];
  }
}

export function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`bad identifier: ${name}`);
  return `"${name}"`;
}

/** PostgreSQL error code for a unique violation. */
export const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
