import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AdminUser } from '@heist/shared';
import {
  UnknownClassQuestionsError,
  type ClassRepository,
} from '@heist/server/classes/ClassRepository';
import {
  CONSENT_STATEMENTS,
  CONSENT_VERSION,
  consentIsCurrent,
  QUESTION_USAGES,
  classInputSchema,
  classUpdateSchema,
  isWeekStart,
  assignmentProblems,
  balanceSquads,
  overallScore,
  DEFAULT_HEIST_SETTINGS,
  type AnalyticsSettings,
  type ClassInput,
  type ClassRecord,
} from '@heist/shared';
import type { PlayerRepository } from '@heist/server/players/PlayerRepository';
import type { QuestionStore } from '@heist/server/questions/QuestionStore';
import { NAME_REASONS, checkDisplayName, type NameRules } from '@heist/shared';
import type { ClassResultRepository } from '@heist/server/classes/ClassResults';
import type { ProfileStore } from '@heist/server/analytics/AttemptStore';
import type { LeagueService } from '@heist/server/progress/LeagueService';
import type { GameControl, RoomCommand } from './GameControl';
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
export const canManage = (user: AdminUser, record: ClassRecord): boolean =>
  user.role === 'admin' || record.ownerUserId === user.id;

export interface ClassRouteDeps {
  readonly classes: ClassRepository;
  readonly questions: QuestionStore;
  readonly players: PlayerRepository;
  readonly events: AdminEventBus;
  readonly results: ClassResultRepository;
  /** The weekly league (26.6). */
  readonly league?: LeagueService;
  /** Mastery of each student, for balancing squads by it (Phase 27.2). */
  readonly profiles?: ProfileStore;
  readonly analytics?: () => Promise<AnalyticsSettings>;
  /** The running game, for the live controls; none when the admin is not wired to a game server. */
  readonly game?: GameControl;
  /** The display-name rules (a teacher's rename obeys them too). */
  readonly nameRules: () => Promise<NameRules>;
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
    void deps.game?.command(before.id, { action: 'refresh' }); // a running room takes the edit now
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

  // --- the school's consent (21.3): a class cannot start, or take students, without it ---
  router.post('/classes/:id/consent', async (req, res) => {
    const record = await load(res, idParam(req.params.id));
    const body = parse(
      z.object({
        version: z.number().int(),
        // Every statement, ticked: nothing is accepted by default.
        accepted: z.array(z.string()).max(50),
      }),
      req.body,
    );
    if (body.version !== CONSENT_VERSION)
      throw new HttpError(
        409,
        'consent_outdated',
        'The terms have changed. Reload the page and read them again.',
      );
    const missing = CONSENT_STATEMENTS.filter((s) => !body.accepted.includes(s.id)).map(
      (s) => s.id,
    );
    if (missing.length > 0)
      throw new HttpError(400, 'consent_incomplete', 'Every statement has to be accepted.', {
        missing,
      });
    const updated = await deps.classes.acceptConsent(
      record.id,
      CONSENT_VERSION,
      requireUser(res).id,
    );
    if (!updated) throw notFound('Class');
    audit(res, 'consent', record.id, { version: CONSENT_VERSION });
    res.json({ class: describeClass(updated) });
  });

  router.post('/classes/:id/lock', async (req, res) => {
    const record = await load(res, idParam(req.params.id));
    const { locked } = parse(z.object({ locked: z.boolean() }), req.body);
    const updated = await deps.classes.setLocked(record.id, locked);
    if (!updated) throw notFound('Class');
    audit(res, locked ? 'lock' : 'unlock', record.id, {});
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
    void deps.game?.command(record.id, { action: 'refresh' });
    res.json({ links });
  });

  // --- squads (Phase 27): the teacher's list, and a balanced one made from mastery ---
  const maxSquads = (record: ClassRecord) =>
    Math.min(
      DEFAULT_HEIST_SETTINGS.squadNames.length,
      Math.ceil(record.playerCap / record.squadSize),
    );
  const squadView = async (record: ClassRecord) => ({
    mode: record.squadMode,
    size: record.squadSize,
    max: maxSquads(record),
    assignments: await deps.classes.squads(record.id),
  });

  router.get('/classes/:id/squads', async (req, res) => {
    res.json(await squadView(await load(res, idParam(req.params.id))));
  });

  router.put('/classes/:id/squads', async (req, res) => {
    const record = await load(res, idParam(req.params.id));
    const { assignments } = parse(
      z.object({ assignments: z.record(z.string().regex(/^\d+$/), z.number().int().min(1)) }),
      req.body,
    );
    const list = Object.fromEntries(Object.entries(assignments).map(([id, s]) => [Number(id), s]));
    const problems = assignmentProblems(list, record.squadSize, maxSquads(record));
    if (problems.length > 0) throw new HttpError(400, 'bad_squads', problems.join('; '));
    await deps.classes.setSquads(record.id, list);
    audit(res, 'squads', record.id, { students: Object.keys(list).length });
    void deps.game?.command(record.id, { action: 'refresh' });
    res.json(await squadView(record));
  });

  router.post('/classes/:id/squads/balance', async (req, res) => {
    const record = await load(res, idParam(req.params.id));
    if (!deps.profiles || !deps.analytics)
      throw new HttpError(503, 'unavailable', 'Mastery is not available to balance by');
    const profiles = deps.profiles;
    const settings = await deps.analytics();
    const members = await deps.classes.members(record.id);
    const students = await Promise.all(
      members.map(async (m) => ({
        id: m.playerId,
        score: overallScore(await profiles.load(m.playerId, { kind: 'all' }), settings),
      })),
    );
    const list = balanceSquads(students, record.squadSize, maxSquads(record));
    await deps.classes.setSquads(record.id, list);
    // A balanced list is the "auto" way of forming squads.
    const updated = (await deps.classes.update(record.id, { squadMode: 'auto' })) ?? record;
    audit(res, 'squads', record.id, { balanced: students.length });
    void deps.game?.command(record.id, { action: 'refresh' });
    res.json(await squadView(updated));
  });

  // --- live controls (14.7): what the teacher does while the room runs ---
  const live = async (res: Response, id: number, command: RoomCommand) => {
    const record = await load(res, id);
    // A class cannot start before the school has accepted the terms (the game server checks too).
    if (command.action === 'start' && !consentIsCurrent(record.consent))
      throw new HttpError(409, 'consent_required', liveReason('consent_required'));
    if (!deps.game)
      throw new HttpError(503, 'no_game_server', 'The admin is not connected to a game server');
    const result = await deps.game.command(record.id, command);
    if (!result.ok) {
      const code = result.reason === 'not_live' || result.reason === 'consent_required' ? 409 : 502;
      throw new HttpError(code, result.reason, liveReason(result.reason));
    }
    return { record, status: result.status };
  };

  router.get('/classes/:id/live', async (req, res) => {
    const record = await load(res, idParam(req.params.id));
    const status = deps.game ? await deps.game.status(record.id) : undefined;
    res.json({ status: status ?? { state: 'waiting' }, connected: status !== undefined });
  });

  for (const [path, action] of [
    ['start', 'start'],
    ['stop', 'stop'],
    ['end-round', 'end_round'],
    ['next-round', 'next_round'],
  ] as const) {
    router.post(`/classes/:id/live/${path}`, async (req, res) => {
      const { record, status } = await live(res, idParam(req.params.id), { action });
      audit(res, 'live', record.id, { action });
      res.json({ status });
    });
  }

  router.post('/classes/:id/live/kick', async (req, res) => {
    const { playerId } = parse(z.object({ playerId: z.number().int().positive() }), req.body);
    const { record, status } = await live(res, idParam(req.params.id), {
      action: 'kick',
      accountId: playerId,
    });
    audit(res, 'live', record.id, { action: 'kick', playerId });
    res.json({ status });
  });

  router.post('/classes/:id/live/rename', async (req, res) => {
    const { playerId, displayName } = parse(
      z.object({ playerId: z.number().int().positive(), displayName: z.string().max(100) }),
      req.body,
    );
    const record = await load(res, idParam(req.params.id));
    if (!(await deps.classes.isMember(record.id, playerId))) throw notFound('Student');
    const verdict = checkDisplayName(displayName, await deps.nameRules());
    if (!verdict.ok)
      throw new HttpError(
        400,
        'bad_name',
        NAME_REASONS[verdict.reason] ?? 'That name is not allowed',
      );
    const before = await deps.players.findById(playerId);
    const player = await deps.players.rename(playerId, verdict.name);
    if (!player) throw notFound('Student');
    const actor = requireUser(res);
    deps.events.publish({
      type: 'player_changed',
      action: 'rename',
      playerId,
      actor: { id: actor.id, email: actor.email },
      detail: { from: before?.displayName, to: player.displayName, class: record.id },
    });
    // Rename in the running room too, if there is one (not being live is fine).
    void deps.game?.command(record.id, {
      action: 'rename',
      accountId: playerId,
      name: player.displayName,
    });
    res.json({ player: { id: player.id, displayName: player.displayName } });
  });

  // --- results (14.9): finished rounds, kept after the room closes ---
  router.get('/classes/:id/results', async (req, res) => {
    const record = await load(res, idParam(req.params.id));
    res.json({ rounds: await deps.results.rounds(record.id) });
  });

  router.get('/classes/:id/results/:roundId', async (req, res) => {
    const record = await load(res, idParam(req.params.id));
    const detail = await deps.results.round(record.id, idParam(req.params.roundId));
    if (!detail) throw notFound('Round');
    res.json(detail);
  });

  // --- replay (35.2): the recorded round, for the teacher to watch ---
  router.get('/classes/:id/results/:roundId/replay', async (req, res) => {
    const record = await load(res, idParam(req.params.id));
    const replay = await deps.results.replay(record.id, idParam(req.params.roundId));
    if (!replay) throw notFound('Replay');
    res.json(replay);
  });

  // --- the weekly league (26.6): learning counts for more than cash ---
  router.get('/classes/:id/league', async (req, res) => {
    const record = await load(res, idParam(req.params.id));
    if (!deps.league) throw notFound('League');
    const week = typeof req.query.week === 'string' ? req.query.week : undefined;
    if (week !== undefined && !isWeekStart(week))
      throw new HttpError(400, 'bad_week', 'A week is given by its Monday, YYYY-MM-DD.');
    res.json(await deps.league.table(record.id, week));
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

const liveReason = (reason: string): string =>
  reason === 'not_live'
    ? 'The class is not running. Start it first.'
    : reason === 'consent_required'
      ? 'The school has not accepted the terms for this class yet. Open the class and accept them first.'
      : reason === 'game_server_unreachable'
        ? 'The game server did not answer.'
        : 'The game server could not do that.';
