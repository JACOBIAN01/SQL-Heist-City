import { Router } from 'express';
import { rewardMapUpdateSchema } from '@heist/shared';
import { requireLogin, requireRole, requireUser } from '../auth/middleware';
import { parse } from '../http/errors';
import { SECTION_NAMES, type SectionName, type SettingsService } from './SettingsService';

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

  router.get('/config/combat', (_req, res) => {
    res.json({ combat: settings.combatSettings() });
  });

  router.put('/config/combat', requireRole('admin'), (req, res) => {
    const body = (req.body ?? {}) as { combat?: unknown };
    res.json({ combat: settings.updateCombatSettings(body.combat ?? {}, requireUser(res)) });
  });

  router.get('/config/tutorial', (_req, res) => {
    res.json({ tutorial: settings.tutorialSettings() });
  });

  router.put('/config/tutorial', requireRole('admin'), (req, res) => {
    const body = (req.body ?? {}) as { tutorial?: unknown };
    res.json({ tutorial: settings.updateTutorialSettings(body.tutorial ?? {}, requireUser(res)) });
  });

  // Heist rules, cars, time of day and the city: plain numbers, one generic pair of routes each.
  for (const name of SECTION_NAMES) {
    router.get(`/config/${name}`, (_req, res) => {
      res.json({ [name]: settings.section(name as SectionName) });
    });
    router.put(`/config/${name}`, requireRole('admin'), (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.json({
        [name]: settings.updateSection(name as SectionName, body[name] ?? {}, requireUser(res)),
      });
    });
  }

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
