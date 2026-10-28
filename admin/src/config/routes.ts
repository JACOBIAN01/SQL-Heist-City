import { Router } from 'express';
import { rewardMapUpdateSchema } from '@heist/shared';
import { requireLogin, requireRole, requireUser } from '../auth/middleware';
import { parse } from '../http/errors';
import { SECTION_NAMES, type SectionName, type SettingsService } from './SettingsService';

/** Anyone logged in can read; only admins change gameplay numbers. */
export function configRoutes(settings: SettingsService): Router {
  const router = Router();
  router.use('/config', requireLogin);

  router.get('/config/settings', async (_req, res) => {
    res.json({ challenges: await settings.challengeSettings() });
  });

  router.put('/config/settings', requireRole('admin'), async (req, res) => {
    const body = (req.body ?? {}) as { challenges?: unknown };
    res.json({
      challenges: await settings.updateChallengeSettings(body.challenges ?? {}, requireUser(res)),
    });
  });

  router.get('/config/combat', async (_req, res) => {
    res.json({ combat: await settings.combatSettings() });
  });

  router.put('/config/combat', requireRole('admin'), async (req, res) => {
    const body = (req.body ?? {}) as { combat?: unknown };
    res.json({ combat: await settings.updateCombatSettings(body.combat ?? {}, requireUser(res)) });
  });

  router.get('/config/tutorial', async (_req, res) => {
    res.json({ tutorial: await settings.tutorialSettings() });
  });

  router.put('/config/tutorial', requireRole('admin'), async (req, res) => {
    const body = (req.body ?? {}) as { tutorial?: unknown };
    res.json({
      tutorial: await settings.updateTutorialSettings(body.tutorial ?? {}, requireUser(res)),
    });
  });

  // The cheat code (Phase 37): admin only, even to read; the code is write-only.
  router.get('/config/cheat', requireRole('admin'), async (_req, res) => {
    res.json({ cheat: await settings.cheatSettings() });
  });

  router.put('/config/cheat', requireRole('admin'), async (req, res) => {
    const body = (req.body ?? {}) as { cheat?: unknown };
    res.json({ cheat: await settings.updateCheatSettings(body.cheat ?? {}, requireUser(res)) });
  });

  // Heist rules, cars, time of day and the city: plain numbers, one generic pair of routes each.
  for (const name of SECTION_NAMES) {
    router.get(`/config/${name}`, async (_req, res) => {
      res.json({ [name]: await settings.section(name as SectionName) });
    });
    router.put(`/config/${name}`, requireRole('admin'), async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.json({
        [name]: await settings.updateSection(
          name as SectionName,
          body[name] ?? {},
          requireUser(res),
        ),
      });
    });
  }

  router.get('/config/reward-map', async (_req, res) => {
    res.json({ rewards: await settings.rewardMap() });
  });

  router.put('/config/reward-map', requireRole('admin'), async (req, res) => {
    res.json({
      rewards: await settings.updateRewardMap(
        parse(rewardMapUpdateSchema, req.body),
        requireUser(res),
      ),
    });
  });

  return router;
}
