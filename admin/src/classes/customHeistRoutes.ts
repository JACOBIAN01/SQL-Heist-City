import { Router } from 'express';
import { z } from 'zod';
import { SHARE_CODE, customHeistSpecSchema } from '@heist/shared';
import type {
  CustomHeistRecord,
  CustomHeistRepository,
} from '@heist/server/classes/CustomHeistRepository';
import type { QuestionStore } from '@heist/server/questions/QuestionStore';
import { requireLogin, requireUser } from '../auth/middleware';
import { HttpError, forbidden, notFound, parse } from '../http/errors';
import { idParam } from '../http/params';

export interface CustomHeistRouteDeps {
  readonly heists: CustomHeistRepository;
  readonly questions: QuestionStore;
}

const importSchema = z.object({ code: z.string().trim().toUpperCase().regex(SHARE_CODE) });

/**
 * A teacher's own heists (Phase 34.5): save a story and a chain of questions, share it by code, copy
 * another teacher's by code. A heist is private to its teacher until they hand out its code; a class
 * plays it by taking `custom-<id>` as its mode.
 */
export function customHeistRoutes(deps: CustomHeistRouteDeps): Router {
  const router = Router();
  router.use('/custom-heists', requireLogin);

  const describe = (r: CustomHeistRecord) => ({
    id: r.id,
    name: r.name,
    spec: r.spec,
    shareCode: r.shareCode,
    mode: `custom-${r.id}`,
  });
  const owned = async (res: Parameters<typeof requireUser>[0], id: number) => {
    const record = await deps.heists.get(id);
    if (!record) throw notFound('Custom heist');
    const user = requireUser(res);
    if (user.role !== 'admin' && record.ownerUserId !== user.id) throw forbidden();
    return record;
  };
  /** Every question must exist, or the heist could not be played. */
  const checkQuestions = async (slugs: readonly string[]) => {
    for (const slug of slugs)
      if (!(await deps.questions.getBySlug(slug)))
        throw new HttpError(422, 'unknown_question', `There is no question called "${slug}".`);
  };

  router.get('/custom-heists', async (_req, res) => {
    const user = requireUser(res);
    const list = await deps.heists.list(user.role === 'admin' ? undefined : user.id);
    res.json({ heists: list.map(describe) });
  });

  router.post('/custom-heists', async (req, res) => {
    const spec = parse(customHeistSpecSchema, req.body);
    await checkQuestions(spec.locks);
    const made = await deps.heists.create(requireUser(res).id, spec);
    res.status(201).json({ heist: describe(made) });
  });

  router.post('/custom-heists/import', async (req, res) => {
    const { code } = parse(importSchema, req.body);
    const found = await deps.heists.byShareCode(code);
    if (!found) throw notFound('Share code');
    // A copy of its own: the other teacher's later edits do not reach it, nor its code.
    const copy = await deps.heists.create(requireUser(res).id, {
      ...found.spec,
      name: `${found.spec.name} (copy)`.slice(0, 60),
    });
    res.status(201).json({ heist: describe(copy) });
  });

  router.get('/custom-heists/:id', async (req, res) => {
    res.json({ heist: describe(await owned(res, idParam(req.params.id))) });
  });

  router.put('/custom-heists/:id', async (req, res) => {
    const before = await owned(res, idParam(req.params.id));
    const spec = parse(customHeistSpecSchema, req.body);
    await checkQuestions(spec.locks);
    const updated = await deps.heists.update(before.id, spec);
    if (!updated) throw notFound('Custom heist');
    res.json({ heist: describe(updated) });
  });

  router.delete('/custom-heists/:id', async (req, res) => {
    const record = await owned(res, idParam(req.params.id));
    await deps.heists.remove(record.id);
    res.status(204).end();
  });

  return router;
}
