import { Router } from 'express';
import { z } from 'zod';
import { NAME_REASONS, checkDisplayName, type NameRules } from '@heist/shared';
import type { PlayerRepository } from '@heist/server/players/PlayerRepository';
import { requireLogin, requireUser } from '../auth/middleware';
import type { AdminEventBus } from '../events/AdminEvents';
import { HttpError, notFound, parse } from '../http/errors';
import { idParam } from '../http/params';
import { publicPlayer } from './playerRoutes';

const searchSchema = z.object({
  q: z.string().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Staff view of players: find one, and rename them (a teacher fixing a silly or rude name). */
export function playerStaffRoutes(
  players: PlayerRepository,
  rules: () => Promise<NameRules>,
  events: AdminEventBus,
): Router {
  const router = Router();
  router.use('/players', requireLogin);

  router.get('/players', async (req, res) => {
    const { q, limit } = parse(searchSchema, req.query);
    res.json({ players: (await players.search(q, limit)).map(publicPlayer) });
  });

  router.put('/players/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const { displayName } = parse(z.object({ displayName: z.string().max(100) }), req.body);
    const verdict = checkDisplayName(displayName, await rules());
    if (!verdict.ok)
      throw new HttpError(
        400,
        'bad_name',
        NAME_REASONS[verdict.reason] ?? 'That name is not allowed',
      );
    const before = await players.findById(id);
    const player = before && (await players.rename(id, verdict.name));
    if (!player) throw notFound('Player');
    const actor = requireUser(res);
    events.publish({
      type: 'player_changed',
      action: 'rename',
      playerId: id,
      actor: { id: actor.id, email: actor.email },
      detail: { from: before.displayName, to: player.displayName },
    });
    res.json({ player: publicPlayer(player) });
  });

  return router;
}
