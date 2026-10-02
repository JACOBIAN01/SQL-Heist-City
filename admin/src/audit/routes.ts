import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/middleware';
import { parse } from '../http/errors';
import type { SqliteAuditLog } from './AuditLog';

const auditQuerySchema = z.object({
  entity: z.enum(['question', 'settings', 'user', 'pool']).optional(),
  entityId: z.string().max(100).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export function auditRoutes(log: SqliteAuditLog): Router {
  const router = Router();
  router.get('/audit', requireRole('admin'), (req, res) => {
    const q = parse(auditQuerySchema, req.query);
    res.json({
      entries: log.list({
        ...(q.entity === undefined ? {} : { entity: q.entity }),
        ...(q.entityId === undefined ? {} : { entityId: q.entityId }),
        ...(q.before === undefined ? {} : { before: q.before }),
        ...(q.limit === undefined ? {} : { limit: q.limit }),
      }),
    });
  });
  return router;
}
