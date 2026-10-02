import { Router } from 'express';
import { createUserSchema, updateUserSchema } from '@heist/shared';
import type { AuthService } from '../auth/AuthService';
import { requireRole, requireUser } from '../auth/middleware';
import { HttpError, conflict, notFound, parse } from '../http/errors';
import { idParam } from '../http/params';

/** User management — admins only. */
export function userRoutes(auth: AuthService): Router {
  const router = Router();
  router.use('/users', requireRole('admin'));

  router.get('/users', (_req, res) => {
    res.json({ users: auth.listUsers() });
  });

  router.post('/users', async (req, res) => {
    const body = parse(createUserSchema, req.body);
    if (auth.findUserByEmail(body.email)) throw conflict('A user with that email already exists');
    res.status(201).json({ user: await auth.createUser(body.email, body.password, body.role) });
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
    res.json({ user });
  });

  return router;
}
