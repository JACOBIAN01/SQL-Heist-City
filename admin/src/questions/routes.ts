import { Router } from 'express';
import {
  previewRequestSchema,
  questionListQuerySchema,
  questionTemplateSchema,
} from '@heist/shared';
import { z } from 'zod';
import { requireLogin, requireRole, requireUser } from '../auth/middleware';
import { parse } from '../http/errors';
import { idParam } from '../http/params';
import type { QuestionAdminService } from './QuestionAdminService';
import type { QuestionTester } from './QuestionTester';

export function questionRoutes(questions: QuestionAdminService, tester: QuestionTester): Router {
  const router = Router();
  router.use('/questions', requireLogin);

  router.get('/questions', (req, res) => {
    res.json({ questions: questions.list(parse(questionListQuerySchema, req.query)) });
  });

  router.post('/questions', async (req, res) => {
    const template = parse(questionTemplateSchema, req.body);
    res.status(201).json({ question: await questions.create(template, requireUser(res)) });
  });

  router.get('/questions/:id', (req, res) => {
    res.json({ question: questions.get(idParam(req.params.id)) });
  });

  router.put('/questions/:id', async (req, res) => {
    const template = parse(questionTemplateSchema, req.body);
    res.json({
      question: await questions.update(idParam(req.params.id), template, requireUser(res)),
    });
  });

  router.delete('/questions/:id', requireRole('admin'), (req, res) => {
    questions.remove(idParam(req.params.id), requireUser(res));
    res.status(204).end();
  });

  router.post('/questions/:id/enable', (req, res) => {
    res.json({ question: questions.setEnabled(idParam(req.params.id), true, requireUser(res)) });
  });

  router.post('/questions/:id/disable', (req, res) => {
    res.json({ question: questions.setEnabled(idParam(req.params.id), false, requireUser(res)) });
  });

  router.post('/questions/:id/duplicate', (req, res) => {
    res
      .status(201)
      .json({ question: questions.duplicate(idParam(req.params.id), requireUser(res)) });
  });

  router.get('/questions/:id/versions', (req, res) => {
    res.json({ versions: questions.versions(idParam(req.params.id)) });
  });

  router.post('/questions/:id/rollback/:version', async (req, res) => {
    const question = await questions.rollback(
      idParam(req.params.id),
      idParam(req.params.version),
      requireUser(res),
    );
    res.json({ question });
  });

  // Preview a saved question.
  router.post('/questions/:id/preview', async (req, res) => {
    const { seeds, studentSql } = parse(previewRequestSchema, req.body);
    const { template } = questions.get(idParam(req.params.id));
    res.json({ report: await tester.test(template, seeds, studentSql) });
  });

  // Preview an unsaved draft from the editor.
  router.post('/questions/preview', async (req, res) => {
    const body = parse(previewRequestSchema.extend({ template: z.unknown() }), req.body);
    const template = parse(questionTemplateSchema, body.template);
    res.json({ report: await tester.test(template, body.seeds, body.studentSql) });
  });

  return router;
}
