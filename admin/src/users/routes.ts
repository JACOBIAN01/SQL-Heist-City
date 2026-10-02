import { Router } from 'express';
import { createUserSchema, updateUserSchema } from '@heist/shared';
import type { AuthService } from '../auth/AuthService';
import type { AdminEventBus } from '../events/AdminEvents';
import { requireRole, requireUser } from '../auth/middleware';
import { HttpError, conflict, notFound, parse } from '../http/errors';
import { idParam } from '../http/params';

/** User management — admins only. */
export function userRoutes(auth: AuthService, events: AdminEventBus): Router {
  const router = Router();
  router.use('/users', requireRole('admin'));

  router.get('/users', (_req, res) => {
    res.json({ users: auth.listUsers() });
  });

  router.post('/users', async (req, res) => {
    const body = parse(createUserSchema, req.body);
    if (auth.findUserByEmail(body.email)) throw conflict('A user with that email already exists');
    const user = await auth.createUser(body.email, body.password, body.role);
    const actor = requireUser(res);
    events.publish({
      type: 'user_changed',
      action: 'create',
      userId: user.id,
      actor: { id: actor.id, email: actor.email },
      detail: { email: user.email, role: user.role },
    });
    res.status(201).json({ user });
  });

  router.put('/users/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const body = parse(updateUserSchema, req.body);
    if (id === requireUser(res).id && (body.disabled === true || body.role === 'teacher')) {
      // Prevents an admin from locking everyone out by accident.
      throw new HttpError(400, 'self_lockout', "You can't disable or demote your own account");
    }
    const user = await auth.updateUser(id, body);
    if (!user) throw notFound('User');
    const actor = requireUser(res);
    events.publish({
      type: 'user_changed',
      action: 'update',
      userId: id,
      actor: { id: actor.id, email: actor.email },
      // Never log the password itself — only that it changed.
      detail: { ...body, ...(body.password === undefined ? {} : { password: 'changed' }) },
    });
    res.json({ user });
  });

  return router;
}
