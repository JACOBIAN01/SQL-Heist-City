import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AdminUser } from '@heist/shared';
import {
  UnknownClassQuestionsError,
  type ClassRepository,
} from '@heist/server/classes/ClassRepository';
import {
  QUESTION_USAGES,
  classInputSchema,
  classUpdateSchema,
  type ClassInput,
  type ClassRecord,
} from '@heist/shared';
import type { PlayerRepository } from '@heist/server/players/PlayerRepository';
import type { QuestionStore } from '@heist/server/questions/QuestionStore';
import { requireLogin, requireUser } from '../auth/middleware';
import type { AdminEventBus, ClassChanged } from '../events/AdminEvents';
import { HttpError, forbidden, notFound, parse } from '../http/errors';
import { idParam } from '../http/params';

const questionSetSchema = z.object({
  links: z
    .array(z.object({ questionId: z.number().int().positive(), usage: z.enum(QUESTION_USAGES) }))
    .max(2000),
});

/** Teachers manage their own classes; admins manage all of them. */
const canManage = (user: AdminUser, record: ClassRecord): boolean =>
  user.role === 'admin' || record.ownerUserId === user.id;

export interface ClassRouteDeps {
  readonly classes: ClassRepository;
  readonly questions: QuestionStore;
  readonly players: PlayerRepository;
  readonly events: AdminEventBus;
}

/** What the admin shows about a class. */
export function describeClass(record: ClassRecord) {
  return { ...record };
}

export function classRoutes(deps: ClassRouteDeps): Router {
  const router = Router();
  router.use('/classes', requireLogin);

  const load = async (res: Response, id: number): Promise<ClassRecord> => {
    const record = await deps.classes.get(id);
    if (!record) throw notFound('Class');
    if (!canManage(requireUser(res), record)) throw forbidden();
    return record;
  };
  const audit = (
    res: Response,
    action: ClassChanged['action'],
    classId: number,
    detail: Record<string, unknown> = {},
  ) => {
    const actor = requireUser(res);
    deps.events.publish({
      type: 'class_changed',
      action,
      classId,
      actor: { id: actor.id, email: actor.email },
      detail,
    });
  };

  router.get('/classes', async (req, res) => {
    const user = requireUser(res);
    const includeArchived = req.query.archived === '1';
    const list = await deps.classes.list({
      ...(user.role === 'admin' ? {} : { ownerUserId: user.id }),
      includeArchived,
    });
    res.json({ classes: list.map(describeClass) });
  });

  router.post('/classes', async (req, res) => {
    const input = parse(classInputSchema, req.body);
    const record = await deps.classes.create(input, requireUser(res).id);
    audit(res, 'create', record.id, { name: record.name, code: record.code });
    res.status(201).json({ class: describeClass(record) });
  });

  router.get('/classes/:id', async (req, res) => {
    const record = await load(res, idParam(req.params.id));
    res.json({ class: describeClass(record) });
  });

  router.put('/classes/:id', async (req, res) => {
    const before = await load(res, idParam(req.params.id));
    const changes = parse(classUpdateSchema, req.body);
    const updated = await deps.classes.update(before.id, changes as Partial<ClassInput>);
    if (!updated) throw notFound('Class');
    audit(res, 'update', before.id, { changes });
    res.json({ class: describeClass(updated) });
  });

  router.delete('/classes/:id', async (req, res) => {
    const before = await load(res, idParam(req.params.id));
    await deps.classes.archive(before.id);
    audit(res, 'archive', before.id, { name: before.name });
    res.status(204).end();
  });

  router.post('/classes/:id/code', async (req, res) => {
    const before = await load(res, idParam(req.params.id));
    const updated = await deps.classes.regenerateCode(before.id);
    if (!updated) throw notFound('Class');
    audit(res, 'code', before.id, {});
    res.json({ class: describeClass(updated) });
  });

  router.get('/classes/:id/questions', async (req, res) => {
    const record = await load(res, idParam(req.params.id));
    const links = await deps.classes.questions(record.id);
    const known = new Map((await deps.questions.list()).map((q) => [q.id, q] as const));
    res.json({
      links: links.map((l) => {
        const q = known.get(l.questionId);
        return {
          ...l,
          slug: q?.slug ?? null,
          title: q?.template.title ?? '(removed)',
          tier: q?.template.tier ?? null,
        };
      }),
    });
  });

  router.put('/classes/:id/questions', async (req, res) => {
    const record = await load(res, idParam(req.params.id));
    const { links } = parse(questionSetSchema, req.body);
    try {
      await deps.classes.setQuestions(record.id, links);
    } catch (err) {
      if (err instanceof UnknownClassQuestionsError)
        throw new HttpError(400, 'unknown_questions', err.message, err.ids);
      throw err;
    }
    audit(res, 'questions', record.id, { count: links.length });
    res.json({ links });
  });

  router.get('/classes/:id/roster', async (req, res) => {
    const record = await load(res, idParam(req.params.id));
    const members = await deps.classes.members(record.id);
    const people = await Promise.all(members.map((m) => deps.players.findById(m.playerId)));
    res.json({
      roster: members.map((m, i) => ({
        playerId: m.playerId,
        joinedAt: m.joinedAt,
        displayName: people[i]?.displayName ?? '(deleted)',
        email: people[i]?.email ?? null,
      })),
    });
  });

  return router;
}
