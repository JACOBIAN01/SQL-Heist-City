import { Router } from 'express';
import { poolInputSchema } from '@heist/shared';
import { requireLogin, requireUser } from '../auth/middleware';
import { HttpError, conflict, notFound, parse } from '../http/errors';
import { idParam } from '../http/params';
import type { AdminEventBus } from '../events/AdminEvents';
import {
  DuplicatePoolNameError,
  UnknownQuestionsError,
  type SqlitePoolRepository,
} from './PoolRepository';

export function poolRoutes(pools: SqlitePoolRepository, events: AdminEventBus): Router {
  const router = Router();
  router.use('/pools', requireLogin);

  const translate = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof DuplicatePoolNameError) throw conflict(err.message);
      if (err instanceof UnknownQuestionsError)
        throw new HttpError(400, 'unknown_questions', err.message, err.ids);
      throw err;
    }
  };
  const audit = (
    res: Parameters<typeof requireUser>[0],
    action: 'create' | 'update' | 'delete',
    poolId: number,
    detail: Record<string, unknown>,
  ) => {
    const actor = requireUser(res);
    events.publish({
      type: 'pool_changed',
      action,
      poolId,
      actor: { id: actor.id, email: actor.email },
      detail,
    });
  };

  router.get('/pools', (_req, res) => {
    res.json({ pools: pools.list() });
  });

  router.get('/pools/:id', (req, res) => {
    const pool = pools.get(idParam(req.params.id));
    if (!pool) throw notFound('Pool');
    res.json({ pool });
  });

  router.post('/pools', (req, res) => {
    const data = parse(poolInputSchema, req.body);
    const pool = translate(() => pools.create(data, requireUser(res).email));
    audit(res, 'create', pool.id, { name: pool.name, questions: pool.questionIds.length });
    res.status(201).json({ pool });
  });

  router.put('/pools/:id', (req, res) => {
    const id = idParam(req.params.id);
    const data = parse(poolInputSchema, req.body);
    const before = pools.get(id);
    const pool = translate(() => pools.update(id, data));
    if (!pool) throw notFound('Pool');
    audit(res, 'update', id, {
      name: pool.name,
      questions: pool.questionIds.length,
      previousName: before?.name,
    });
    res.json({ pool });
  });

  router.delete('/pools/:id', (req, res) => {
    const id = idParam(req.params.id);
    const before = pools.get(id);
    if (!before || !pools.remove(id)) throw notFound('Pool');
    audit(res, 'delete', id, { name: before.name });
    res.status(204).end();
  });

  return router;
}
