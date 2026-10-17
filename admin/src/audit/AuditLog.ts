import type { DatabaseSync } from 'node:sqlite';
import type { PgDatabase } from '@heist/server/pg/PgDatabase';
import type { AuditEntry } from '@heist/shared';
import type { AdminEvent, AdminEventBus } from '../events/AdminEvents';

export interface AuditQuery {
  readonly entity?: string;
  readonly entityId?: string;
  /** Return entries with id < before (paging, newest first). */
  readonly before?: number;
  readonly limit?: number;
}

export interface AuditRecord {
  readonly userId: number | null;
  readonly actor: string | null;
  readonly action: string;
  readonly entity: string;
  readonly entityId: string | null;
  readonly detail: Record<string, unknown> | null;
}

// Pattern: Repository (async) — Why: the log is written on SQLite or PostgreSQL behind one contract.
export interface AuditLog {
  record(entry: AuditRecord): Promise<void>;
  list(query?: AuditQuery): Promise<AuditEntry[]>;
  /** Blanks the detail of every entry about one entity (a deleted player's old names), keeping that it happened. */
  scrubDetail(entity: string, entityId: string): Promise<void>;
}

export class SqliteAuditLog implements AuditLog {
  constructor(private readonly db: DatabaseSync) {}

  async record(entry: AuditRecord): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO audit_log (user_id, actor, action, entity, entity_id, detail_json) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        entry.userId,
        entry.actor,
        entry.action,
        entry.entity,
        entry.entityId,
        entry.detail === null ? null : JSON.stringify(entry.detail),
      );
  }

  async scrubDetail(entity: string, entityId: string): Promise<void> {
    this.db
      .prepare('UPDATE audit_log SET detail_json = NULL WHERE entity = ? AND entity_id = ?')
      .run(entity, entityId);
  }

  async list(query: AuditQuery = {}): Promise<AuditEntry[]> {
    const where: string[] = [];
    const args: (string | number)[] = [];
    const add = (clause: string, value: string | number) => {
      where.push(clause);
      args.push(value);
    };
    if (query.entity) add('entity = ?', query.entity);
    if (query.entityId) add('entity_id = ?', query.entityId);
    if (query.before) add('id < ?', query.before);
    const sql = `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY id DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...args, Math.min(query.limit ?? 50, 200)) as unknown as {
      id: number;
      actor: string | null;
      action: string;
      entity: string;
      entity_id: string | null;
      detail_json: string | null;
      at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      actor: r.actor,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      detail:
        r.detail_json === null ? null : (JSON.parse(r.detail_json) as Record<string, unknown>),
      at: r.at,
    }));
  }
}

/** The audit log on PostgreSQL. */
export class PgAuditLog implements AuditLog {
  constructor(private readonly db: PgDatabase) {}

  async record(entry: AuditRecord): Promise<void> {
    await this.db.query(
      'INSERT INTO audit_log (user_id, actor, action, entity, entity_id, detail_json) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        entry.userId,
        entry.actor,
        entry.action,
        entry.entity,
        entry.entityId,
        entry.detail === null ? null : JSON.stringify(entry.detail),
      ],
    );
  }

  async scrubDetail(entity: string, entityId: string): Promise<void> {
    await this.db.query(
      'UPDATE audit_log SET detail_json = NULL WHERE entity = $1 AND entity_id = $2',
      [entity, entityId],
    );
  }

  async list(query: AuditQuery = {}): Promise<AuditEntry[]> {
    const where: string[] = [];
    const args: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      args.push(value);
      where.push(clause.replace('?', `$${args.length}`));
    };
    if (query.entity) add('entity = ?', query.entity);
    if (query.entityId) add('entity_id = ?', query.entityId);
    if (query.before) add('id < ?', query.before);
    args.push(Math.min(query.limit ?? 50, 200));
    const rows = await this.db.query<{
      id: string;
      actor: string | null;
      action: string;
      entity: string;
      entity_id: string | null;
      detail_json: Record<string, unknown> | null;
      at: Date;
    }>(
      `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY id DESC LIMIT $${args.length}`,
      args,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      actor: r.actor,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      detail: r.detail_json,
      at: r.at.toISOString(),
    }));
  }
}

/** Waits for the audit writes started so far (each event's write is queued in order). */
export interface AuditSubscription {
  readonly unsubscribe: () => void;
  flush(): Promise<void>;
}

/** Subscribes the audit log to admin events; writes keep their order and failures are reported, not thrown. */
export function auditAdminEvents(
  bus: AdminEventBus,
  log: AuditLog,
  onError: (err: unknown) => void = () => {},
): AuditSubscription {
  let tail: Promise<void> = Promise.resolve();
  const unsubscribe = bus.subscribe((event) => {
    tail = tail.then(() => log.record(toRecord(event))).catch(onError);
  });
  return { unsubscribe, flush: () => tail };
}

function toRecord(event: AdminEvent): AuditRecord {
  // The scheduled clean-up has no staff actor.
  if (event.type === 'retention_run')
    return {
      userId: null,
      actor: 'retention job',
      action: 'delete',
      entity: 'retention',
      entityId: null,
      detail: event.detail,
    };
  const actor = { userId: event.actor.id, actor: event.actor.email };
  switch (event.type) {
    case 'question_changed':
      return {
        ...actor,
        action: event.action,
        entity: 'question',
        entityId: String(event.questionId),
        detail: {
          ...(event.before && event.after
            ? { changed: changedFields(event.before, event.after) }
            : {}),
          ...(event.after ? { slug: (event.after as { slug: string }).slug } : {}),
          ...event.detail,
        },
      };
    case 'settings_changed':
      return {
        ...actor,
        action: 'update',
        entity: 'settings',
        entityId: event.key,
        detail: { before: event.before ?? null, after: event.after },
      };
    case 'pool_changed':
      return {
        ...actor,
        action: event.action,
        entity: 'pool',
        entityId: String(event.poolId),
        detail: event.detail,
      };
    case 'concept_changed':
      return {
        ...actor,
        action: 'update',
        entity: 'concept',
        entityId: event.topic,
        detail: { version: event.version },
      };
    case 'brief_marked':
      return {
        ...actor,
        action: 'mark',
        entity: 'brief',
        entityId: event.briefId,
        detail: event.detail,
      };
    case 'class_changed':
      return {
        ...actor,
        action: event.action,
        entity: 'class',
        entityId: String(event.classId),
        detail: event.detail,
      };
    case 'player_changed':
      return {
        ...actor,
        action: event.action,
        entity: 'player',
        entityId: String(event.playerId),
        detail: event.detail,
      };
    case 'user_changed':
      return {
        ...actor,
        action: event.action,
        entity: 'user',
        entityId: String(event.userId),
        detail: event.detail,
      };
  }
}

/** Top-level template fields whose value changed — a compact diff for the log. */
export function changedFields(before: object, after: object): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter(
      (k) =>
        JSON.stringify((before as Record<string, unknown>)[k]) !==
        JSON.stringify((after as Record<string, unknown>)[k]),
    )
    .sort();
}
