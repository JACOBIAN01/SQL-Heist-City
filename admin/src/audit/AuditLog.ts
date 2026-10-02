import type { DatabaseSync } from 'node:sqlite';
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

export class SqliteAuditLog {
  constructor(private readonly db: DatabaseSync) {}

  record(entry: AuditRecord): void {
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

  list(query: AuditQuery = {}): AuditEntry[] {
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

/** Subscribes the audit log to admin events. Returns the unsubscribe function. */
export function auditAdminEvents(bus: AdminEventBus, log: SqliteAuditLog): () => void {
  return bus.subscribe((event) => log.record(toRecord(event)));
}

function toRecord(event: AdminEvent): AuditRecord {
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
