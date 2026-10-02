import { Router } from 'express';
import { rewardMapUpdateSchema } from '@heist/shared';
import { requireLogin, requireRole, requireUser } from '../auth/middleware';
import { parse } from '../http/errors';
import type { SettingsService } from './SettingsService';

/** Anyone logged in can read; only admins change gameplay numbers. */
export function configRoutes(settings: SettingsService): Router {
  const router = Router();
  router.use('/config', requireLogin);

  router.get('/config/settings', (_req, res) => {
    res.json({ challenges: settings.challengeSettings() });
  });

  router.put('/config/settings', requireRole('admin'), (req, res) => {
    const body = (req.body ?? {}) as { challenges?: unknown };
    res.json({
      challenges: settings.updateChallengeSettings(body.challenges ?? {}, requireUser(res)),
    });
  });

  router.get('/config/reward-map', (_req, res) => {
    res.json({ rewards: settings.rewardMap() });
  });

  router.put('/config/reward-map', requireRole('admin'), (req, res) => {
    res.json({
      rewards: settings.updateRewardMap(parse(rewardMapUpdateSchema, req.body), requireUser(res)),
    });
  });

  return router;
}
