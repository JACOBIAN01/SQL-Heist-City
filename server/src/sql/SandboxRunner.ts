import type { SandboxData, SandboxErrorCode, QueryResult } from './SqlSandbox';
import { SandboxError, SqlSandbox } from './SqlSandbox';

export interface SandboxQuery {
  readonly sql: string;
  readonly maxRows?: number;
  /**
   * `query` (default) runs a read-only query; `plan` returns its plan lines as one column;
   * `write` runs a write task's statements (the job's database is then writable until the next query).
   */
  readonly mode?: 'query' | 'plan' | 'write';
}

/** One unit of work: build the DB once, run several queries (e.g. student + reference). */
export interface SandboxJob {
  readonly data: SandboxData;
  readonly queries: readonly SandboxQuery[];
}

export type QueryOutcome =
  | { readonly ok: true; readonly result: QueryResult }
  | { readonly ok: false; readonly code: SandboxErrorCode; readonly message: string };

export type JobOutcome =
  | { readonly ok: true; readonly outcomes: readonly QueryOutcome[] }
  /** setup = the question's own schema/data failed to load (author bug, not the student's). */
  | {
      readonly ok: false;
      readonly code: 'timeout' | 'setup' | 'crashed';
      readonly message: string;
    };

// SOLID: D (Dependency Inversion) — Why: graders depend on this interface, so
// tests use the fast in-process runner while production uses the isolated
// worker pool, without the grader knowing which.
export interface SandboxRunner {
  run(job: SandboxJob): Promise<JobOutcome>;
  close(): Promise<void>;
}

/** Executes a job synchronously in the current thread. No timeout protection. */
export function executeJob(job: SandboxJob): JobOutcome {
  let sandbox: SqlSandbox;
  try {
    sandbox = SqlSandbox.create(job.data, {
      writable: job.queries.some((q) => q.mode === 'write'),
    });
  } catch (err) {
    return { ok: false, code: 'setup', message: (err as Error).message };
  }
  try {
    return {
      ok: true,
      outcomes: job.queries.map((q): QueryOutcome => {
        try {
          if (q.mode === 'write') {
            sandbox.write(q.sql);
            return { ok: true, result: { columns: [], rows: [], truncated: false } };
          }
          sandbox.lockReadOnly();
          if (q.mode === 'plan')
            return {
              ok: true,
              result: {
                columns: ['detail'],
                rows: sandbox.plan(q.sql).map((d) => [d]),
                truncated: false,
              },
            };
          return { ok: true, result: sandbox.query(q.sql, q.maxRows) };
        } catch (err) {
          if (err instanceof SandboxError)
            return { ok: false, code: err.code, message: err.message };
          throw err;
        }
      }),
    };
  } finally {
    sandbox.close();
  }
}

/** For tests and tooling: runs jobs inline. Never use for untrusted SQL in a live match. */
export class InProcessSandboxRunner implements SandboxRunner {
  run(job: SandboxJob): Promise<JobOutcome> {
    return Promise.resolve(executeJob(job));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
