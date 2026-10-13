import { Router, type Response } from 'express';
import {
  BLOOM_LEVELS,
  RCSBE_DIMENSIONS,
  RCSBE_NAMES,
  axisScores,
  compareToTarget,
  coverageOf,
  remediation,
  shapeProblems,
  type AnalyticsSettings,
  type AxisScore,
  type ClassRecord,
  type ProfileTotals,
} from '@heist/shared';
import type { AttemptStore, ProfileStore } from '@heist/server/analytics/AttemptStore';
import { scopeView } from '@heist/server/analytics/ProfileAggregator';
import {
  classSpread,
  itemAnalysis,
  itemsCsv,
  poolTotals,
  profilesCsv,
  topicMastery,
  weakestFirst,
  weakestTopics,
} from '@heist/server/analytics/reports';
import type { ClassRepository } from '@heist/server/classes/ClassRepository';
import type { PlayerRepository } from '@heist/server/players/PlayerRepository';
import type { QuestionStore } from '@heist/server/questions/QuestionStore';
import { requireLogin, requireUser } from '../auth/middleware';
import { canManage } from '../classes/classRoutes';
import { forbidden, notFound } from '../http/errors';
import { idParam } from '../http/params';

export interface AnalyticsDeps {
  readonly classes: ClassRepository;
  readonly questions: QuestionStore;
  readonly players: PlayerRepository;
  readonly attempts: AttemptStore;
  readonly profiles: ProfileStore;
  readonly settings: () => Promise<AnalyticsSettings>;
}

const viewsOf = (totals: ProfileTotals, settings: AnalyticsSettings) => scopeView(totals, settings);

/**
 * What a teacher sees about their class's learning: live profiles, the shape of
 * the question set against the target, spread, items and exports. A teacher
 * sees only their own classes (admins all); a student never reaches these
 * routes (they have no staff session).
 */
export function analyticsRoutes(deps: AnalyticsDeps): Router {
  const router = Router();
  router.use('/classes', requireLogin);

  const load = async (res: Response, id: number): Promise<ClassRecord> => {
    const record = await deps.classes.get(id);
    if (!record) throw notFound('Class');
    if (!canManage(requireUser(res), record)) throw forbidden();
    return record;
  };

  /** The class's roster with each student's class-scope profile. */
  const roster = async (record: ClassRecord, settings: AnalyticsSettings) => {
    const members = await deps.classes.members(record.id);
    const stored = new Map(
      (await deps.profiles.loadClass(record.id)).map((p) => [p.accountId, p.totals]),
    );
    const empty = poolTotals([]);
    return Promise.all(
      members.map(async (m) => {
        const totals = stored.get(m.playerId) ?? empty;
        const player = await deps.players.findById(m.playerId);
        return {
          playerId: m.playerId,
          name: player?.displayName ?? '(deleted)',
          totals,
          rcsbe: axisScores(totals, 'rcsbe', settings),
          bloom: axisScores(totals, 'bloom', settings),
        };
      }),
    );
  };

  /** The paper's shape: the class's released questions, by RCSBE share of marks, against the target. */
  const paper = async (record: ClassRecord, settings: AnalyticsSettings) => {
    const ids = new Set((await deps.classes.questions(record.id)).map((l) => l.questionId));
    const all = await deps.questions.list();
    const chosen = all.filter((q) => ids.has(q.id)).map((q) => q.template);
    const coverage = coverageOf(chosen, settings);
    const rows = compareToTarget(coverage, settings.targetProfile);
    return { coverage, rows, problems: shapeProblems(rows, RCSBE_NAMES), questions: chosen.length };
  };

  router.get('/classes/:id/analytics', async (req, res) => {
    const record = await load(res, idParam(req.params.id));
    const settings = await deps.settings();
    const students = await roster(record, settings);
    const pooled = poolTotals(students.map((s) => s.totals));
    const ordered = weakestFirst(students.map((s) => ({ ...s, scores: s.rcsbe })));
    res.json({
      target: settings.targetProfile,
      class: viewsOf(pooled, settings),
      students: ordered.map(({ totals: _t, scores: _s, ...rest }) => rest),
      spread: {
        rcsbe: classSpread(
          students.map((s) => ({ scores: s.rcsbe })),
          [...RCSBE_DIMENSIONS],
        ),
        bloom: classSpread(
          students.map((s) => ({ scores: s.bloom as AxisScore[] })),
          [...BLOOM_LEVELS],
        ),
      },
      paper: await paper(record, settings),
    });
  });

  router.get('/classes/:id/students/:playerId', async (req, res) => {
    const record = await load(res, idParam(req.params.id));
    const playerId = idParam(req.params.playerId);
    if (!(await deps.classes.isMember(record.id, playerId))) throw notFound('Student');
    const settings = await deps.settings();
    const player = await deps.players.findById(playerId);
    const totals = await deps.profiles.load(playerId, { kind: 'class', classId: record.id });
    const classTotals = poolTotals((await deps.profiles.loadClass(record.id)).map((p) => p.totals));
    const rounds = await deps.profiles.loadRounds(playerId, record.id);
    // Only this class's items: a teacher never sees what a student did elsewhere.
    const items = await deps.attempts.itemsOf(playerId, { classId: record.id });
    const mastery = topicMastery(items, settings);
    res.json({
      player: { id: playerId, name: player?.displayName ?? '(deleted)' },
      profile: viewsOf(totals, settings),
      classProfile: viewsOf(classTotals, settings),
      target: settings.targetProfile,
      trend: rounds.map((r) => ({
        round: r.round,
        rcsbe: axisScores(r.totals, 'rcsbe', settings),
      })),
      topics: mastery,
      weakestTopics: weakestTopics(mastery),
      remediation: remediation(axisScores(totals, 'rcsbe', settings)) ?? null,
      items: items.length,
    });
  });

  router.get('/classes/:id/items', async (req, res) => {
    const record = await load(res, idParam(req.params.id));
    const analysis = itemAnalysis(await deps.attempts.itemsOfClass(record.id));
    const known = new Map((await deps.questions.list()).map((q) => [q.id, q] as const));
    res.json({
      items: analysis.map((a) => ({
        ...a,
        slug: known.get(a.questionId)?.slug ?? null,
        title: known.get(a.questionId)?.template.title ?? '(removed)',
      })),
    });
  });

  router.get('/classes/:id/export.csv', async (req, res) => {
    const record = await load(res, idParam(req.params.id));
    const settings = await deps.settings();
    const kind = req.query.kind === 'items' ? 'items' : 'profiles';
    const body =
      kind === 'items'
        ? itemsCsv(itemAnalysis(await deps.attempts.itemsOfClass(record.id)))
        : profilesCsv(
            record.name,
            (await roster(record, settings)).map((s) => ({
              studentId: s.playerId,
              name: s.name,
              totals: s.totals,
            })),
            settings,
          );
    const date = new Date().toISOString().slice(0, 10);
    res
      .type('text/csv; charset=utf-8')
      .attachment(`class-${record.id}-${kind}-${date}.csv`)
      .send(body);
  });

  return router;
}
