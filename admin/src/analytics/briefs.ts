import { Router, type Response } from 'express';
import {
  BLOOM_LEVELS,
  RCSBE_DIMENSIONS,
  briefEarned,
  briefMarkProblem,
  briefMarkSchema,
  emptyTotals,
  type BriefView,
  type ProfileTotals,
} from '@heist/shared';
import type {
  AttemptStore,
  ProfileScope,
  ProfileStore,
} from '@heist/server/analytics/AttemptStore';
import type { BriefStore } from '@heist/server/analytics/BriefStore';
import type { ClassRepository } from '@heist/server/classes/ClassRepository';
import { requireLogin, requireUser } from '../auth/middleware';
import { canManage } from '../classes/classRoutes';
import type { AdminEventBus } from '../events/AdminEvents';
import { HttpError, forbidden, notFound, parse } from '../http/errors';
import { z } from 'zod';

export interface BriefDeps {
  readonly briefs: BriefStore;
  readonly classes: ClassRepository;
  readonly attempts: AttemptStore;
  readonly profiles: ProfileStore;
  readonly events: AdminEventBus;
  readonly now?: () => number;
}

/** A profile change on the brief's two axes only (Build, and its Bloom level). */
function delta(brief: BriefView, earned: number, available: number, items: number): ProfileTotals {
  const t = emptyTotals();
  const tally = { earned, available, items };
  return {
    rcsbe: Object.fromEntries(
      RCSBE_DIMENSIONS.map((d) => [d, d === brief.rcsbe ? tally : t.rcsbe[d]]),
    ) as ProfileTotals['rcsbe'],
    bloom: Object.fromEntries(
      BLOOM_LEVELS.map((l) => [l, l === brief.bloom ? tally : t.bloom[l]]),
    ) as ProfileTotals['bloom'],
  };
}

/**
 * Marks an open brief against its rubric and carries the marks into the student's profile.
 * The first marking adds the brief as one item (its weight available, its share earned); a
 * re-mark only moves the earned marks by the difference, so totals stay additive.
 */
export class BriefMarking {
  constructor(private readonly deps: BriefDeps) {}

  async mark(
    id: string,
    marks: readonly number[],
    feedback: string | null,
    by: string,
  ): Promise<BriefView> {
    const brief = await this.deps.briefs.get(id);
    if (!brief) throw notFound('Brief');
    const problem = briefMarkProblem(brief.rubric, marks);
    if (problem) throw new HttpError(400, 'invalid_marks', problem);
    const result = await this.deps.briefs.mark(
      id,
      marks,
      feedback,
      by,
      (this.deps.now ?? Date.now)(),
    );
    if (!result) throw notFound('Brief');
    const { before, after } = result;
    const earned = briefEarned(after.itemMarks, after.rubric, marks);
    const was = before.marks ? briefEarned(before.itemMarks, before.rubric, before.marks) : 0;
    const first = before.marks === null;
    await this.deps.attempts.rescore(id, { counted: true, available: after.itemMarks, earned });
    if (after.playerId !== null) {
      const scopes: ProfileScope[] = [{ kind: 'all' }];
      if (after.classId !== null) {
        scopes.push({ kind: 'class', classId: after.classId });
        if (after.round !== null)
          scopes.push({ kind: 'round', classId: after.classId, round: after.round });
      }
      await this.deps.profiles.add(
        after.playerId,
        scopes,
        delta(
          after,
          Math.round((earned - was) * 100) / 100,
          first ? after.itemMarks : 0,
          first ? 1 : 0,
        ),
      );
    }
    return after;
  }
}

const listQuery = z.object({
  status: z.enum(['unmarked', 'marked', 'all']).default('unmarked'),
  classId: z.coerce.number().int().positive().optional(),
});

/**
 * The teacher's marking queue: open briefs from their classes (admins see every class), one
 * at a time or in a batch, marked per rubric criterion.
 */
export function briefRoutes(deps: BriefDeps): Router {
  const router = Router();
  const marking = new BriefMarking(deps);
  router.use('/briefs', requireLogin);

  /** The classes this user may mark for: their own, or every one for an admin. */
  const classIdsOf = async (res: Response): Promise<number[] | undefined> => {
    const user = requireUser(res);
    if (user.role === 'admin') return undefined;
    return (await deps.classes.list({ ownerUserId: user.id, includeArchived: true })).map(
      (c) => c.id,
    );
  };

  const loadOwn = async (res: Response, id: string): Promise<BriefView> => {
    const brief = await deps.briefs.get(id);
    if (!brief) throw notFound('Brief');
    const record = brief.classId === null ? null : await deps.classes.get(brief.classId);
    const user = requireUser(res);
    // A brief outside any class (an open match) is for admins to mark.
    if (record ? !canManage(user, record) : user.role !== 'admin') throw forbidden();
    return brief;
  };

  router.get('/briefs', async (req, res) => {
    const q = parse(listQuery, req.query);
    const own = await classIdsOf(res);
    if (q.classId !== undefined && own && !own.includes(q.classId)) throw forbidden();
    const classIds = q.classId !== undefined ? [q.classId] : own;
    res.json({
      briefs: await deps.briefs.list({ ...(classIds ? { classIds } : {}), status: q.status }),
    });
  });

  router.get('/briefs/:id', async (req, res) => {
    res.json({ brief: await loadOwn(res, req.params.id) });
  });

  router.post('/briefs/:id/mark', async (req, res) => {
    const brief = await loadOwn(res, req.params.id);
    const body = parse(briefMarkSchema, req.body);
    const user = requireUser(res);
    const after = await marking.mark(brief.id, body.marks, body.feedback || null, user.email);
    deps.events.publish({
      type: 'brief_marked',
      briefId: brief.id,
      actor: { id: user.id, email: user.email },
      detail: { marks: body.marks, remark: brief.marks !== null },
    });
    res.json({ brief: after });
  });

  return router;
}
