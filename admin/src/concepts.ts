import { Router } from 'express';
import { conceptCardSchema } from '@heist/shared';
import type { ConceptStore } from '@heist/server/concepts/ConceptStore';
import { requireLogin, requireRole, requireUser } from './auth/middleware';
import type { AdminEventBus } from './events/AdminEvents';
import { notFound, parse } from './http/errors';

/** Concept cards: anyone logged in reads them; teachers and admins edit (every edit is a new version). */
export function conceptRoutes(store: ConceptStore, events: AdminEventBus): Router {
  const router = Router();
  router.use('/concepts', requireLogin);

  router.get('/concepts', async (_req, res) => {
    res.json({ cards: await store.list() });
  });

  router.get('/concepts/:topic', async (req, res) => {
    const card = await store.get(String(req.params.topic));
    if (!card) throw notFound('Concept card');
    res.json({ card, versions: await store.versions(card.topic) });
  });

  router.put('/concepts/:topic', requireRole('admin', 'teacher'), async (req, res) => {
    const card = parse(conceptCardSchema, { ...(req.body as object), topic: req.params.topic });
    const actor = requireUser(res);
    const saved = await store.save(card, actor.email);
    events.publish({
      type: 'concept_changed',
      topic: saved.topic,
      version: saved.version,
      actor: { id: actor.id, email: actor.email },
    });
    res.json({ card: saved });
  });

  return router;
}
