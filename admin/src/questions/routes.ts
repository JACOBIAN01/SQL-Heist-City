import { Router } from 'express';
import { questionListQuerySchema, questionTemplateSchema } from '@heist/shared';
import { requireLogin, requireRole, requireUser } from '../auth/middleware';
import { parse } from '../http/errors';
import { idParam } from '../http/params';
import type { QuestionAdminService } from './QuestionAdminService';

export function questionRoutes(questions: QuestionAdminService): Router {
  const router = Router();
  router.use('/questions', requireLogin);

  router.get('/questions', (req, res) => {
    res.json({ questions: questions.list(parse(questionListQuerySchema, req.query)) });
  });

  router.post('/questions', (req, res) => {
    const template = parse(questionTemplateSchema, req.body);
    res.status(201).json({ question: questions.create(template, requireUser(res)) });
  });

  router.get('/questions/:id', (req, res) => {
    res.json({ question: questions.get(idParam(req.params.id)) });
  });

  router.put('/questions/:id', (req, res) => {
    const template = parse(questionTemplateSchema, req.body);
    res.json({ question: questions.update(idParam(req.params.id), template, requireUser(res)) });
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

  return router;
}
