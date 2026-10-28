import { CONSENT_STATEMENTS, CONSENT_VERSION, classInputSchema } from '@heist/shared';
import { ClassRooms } from '@heist/server/classes/ClassRooms';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpServer } from '@heist/server/http/httpServer';
import { startAdmin } from '../testing/harness';
import {
  HttpGameControl,
  type ControlResult,
  type GameControl,
  type RoomCommand,
  type RoomState,
} from './GameControl';

class FakeGame implements GameControl {
  readonly commands: { classId: number; command: RoomCommand }[] = [];
  live = false;
  async status(): Promise<RoomState> {
    return this.live
      ? { state: 'live', port: 9001, players: 3, maxPlayers: 100 }
      : { state: 'waiting' };
  }
  async command(classId: number, command: RoomCommand): Promise<ControlResult> {
    this.commands.push({ classId, command });
    if (command.action === 'start') this.live = true;
    if (command.action === 'stop') this.live = false;
    if (!this.live && command.action !== 'refresh' && command.action !== 'stop')
      return { ok: false, reason: 'not_live' };
    return { ok: true, status: await this.status() };
  }
}

let h: Awaited<ReturnType<typeof startAdmin>> | undefined;
afterEach(() => h?.close());

async function boot(game: GameControl | undefined) {
  h = await startAdmin(game ? { gameControl: game } : {});
  await h.loginAs('ana@school.test', 'teacher');
  const made = await h.client.post<{ class: { id: number } }>('/api/classes', { name: '9B' });
  // The school has accepted the terms (Phase 21.3); the consent tests cover the refusal.
  await h.stores.classes.acceptConsent(made.body.class.id, CONSENT_VERSION, null);
  return { h, id: made.body.class.id };
}

describe('live class controls (14.7)', () => {
  it('start, end the round, next round and stop reach the game and are audited', async () => {
    const game = new FakeGame();
    const { h, id } = await boot(game);
    expect(
      (await h.client.get<{ status: { state: string } }>(`/api/classes/${id}/live`)).body.status
        .state,
    ).toBe('waiting');
    expect((await h.client.post(`/api/classes/${id}/live/end-round`)).status).toBe(409); // not running yet
    const started = await h.client.post<{ status: { state: string; port: number } }>(
      `/api/classes/${id}/live/start`,
    );
    expect(started.body.status).toMatchObject({ state: 'live', port: 9001 });
    expect((await h.client.post(`/api/classes/${id}/live/end-round`)).status).toBe(200);
    expect((await h.client.post(`/api/classes/${id}/live/next-round`)).status).toBe(200);
    expect((await h.client.post(`/api/classes/${id}/live/stop`)).status).toBe(200);
    expect(game.commands.map((c) => c.command.action)).toEqual([
      'end_round',
      'start',
      'end_round',
      'next_round',
      'stop',
    ]);
    await h.admin.settled();
    h.client.clearCookie();
    await h.loginAs('boss@school.test', 'admin');
    const audit = await h.client.get<{ entries: { action: string; detail: { action: string } }[] }>(
      '/api/audit?entity=class',
    );
    expect(
      audit.body.entries.filter((e) => e.action === 'live').map((e) => e.detail.action),
    ).toEqual(['stop', 'next_round', 'end_round', 'start']);
  });

  it('will not start a class until the school has accepted the terms, and records who did (21.3)', async () => {
    const game = new FakeGame();
    h = await startAdmin({ gameControl: game });
    await h.loginAs('ana@school.test', 'teacher');
    const id = (await h.client.post<{ class: { id: number } }>('/api/classes', { name: '9B' })).body
      .class.id;
    const start = () => h?.client.post(`/api/classes/${id}/live/start`, {});

    const refused = await start();
    expect(refused?.status).toBe(409);
    expect(refused?.body).toMatchObject({ error: { code: 'consent_required' } });
    expect(game.commands).toEqual([]); // the game server was never asked

    // Every statement has to be ticked, and it has to be the current wording.
    const part = await h.client.post(`/api/classes/${id}/consent`, {
      version: CONSENT_VERSION,
      accepted: CONSENT_STATEMENTS.slice(1).map((c) => c.id),
    });
    expect(part.status).toBe(400);
    const old = await h.client.post(`/api/classes/${id}/consent`, {
      version: CONSENT_VERSION - 1,
      accepted: CONSENT_STATEMENTS.map((c) => c.id),
    });
    expect(old.status).toBe(409);
    expect((await start())?.status).toBe(409);

    const ok = await h.client.post<{ class: { consent: { version: number; byUserId: number } } }>(
      `/api/classes/${id}/consent`,
      { version: CONSENT_VERSION, accepted: CONSENT_STATEMENTS.map((c) => c.id) },
    );
    expect(ok.status).toBe(200);
    expect(ok.body.class.consent).toMatchObject({ version: CONSENT_VERSION });
    expect((await start())?.status).toBe(200);
    await h.admin.settled();
    const audit = await h.stores.audit.list({ entity: 'class' });
    expect(audit.map((e) => e.action)).toContain('consent');
  });

  it('the game server refuses a start without consent too, whatever the admin says', async () => {
    h = await startAdmin();
    const stores = h.stores;
    const made = await stores.classes.create({ ...classInputSchema.parse({ name: 'X' }) }, null);
    const rooms = new ClassRooms({ classes: stores.classes } as never);
    expect(await rooms.handle(made.id, { action: 'start' })).toEqual({
      ok: false,
      reason: 'consent_required',
    });
  });

  it('kicks a student by account, and renames one in the class through the same rules', async () => {
    const game = new FakeGame();
    game.live = true;
    const { h, id } = await boot(game);
    expect((await h.client.post(`/api/classes/${id}/live/kick`, { playerId: 42 })).status).toBe(
      200,
    );
    expect(game.commands.at(-1)).toEqual({
      classId: id,
      command: { action: 'kick', accountId: 42 },
    });
    expect((await h.client.post(`/api/classes/${id}/live/kick`, { playerId: 0 })).status).toBe(400);
    expect(
      (await h.client.post(`/api/classes/${id}/live/rename`, { playerId: 42, displayName: 'Fine' }))
        .status,
    ).toBe(404); // not in this class
  });

  it('only the owner or an admin may run a class; others are refused', async () => {
    const game = new FakeGame();
    const { h, id } = await boot(game);
    h.client.clearCookie();
    await h.loginAs('bob@school.test', 'teacher');
    expect((await h.client.post(`/api/classes/${id}/live/start`)).status).toBe(403);
    expect(game.commands).toEqual([]);
  });

  it('editing a running class tells the room', async () => {
    const game = new FakeGame();
    const { h, id } = await boot(game);
    await h.client.put(`/api/classes/${id}`, { banksOpen: [1, 2] });
    expect(game.commands.at(-1)).toEqual({ classId: id, command: { action: 'refresh' } });
  });

  it('says so when no game server is connected', async () => {
    const { h, id } = await boot(undefined);
    expect((await h.client.post(`/api/classes/${id}/live/start`)).status).toBe(503);
    expect(
      (await h.client.get<{ connected: boolean }>(`/api/classes/${id}/live`)).body.connected,
    ).toBe(false);
  });
});

describe('HttpGameControl against the game server’s own HTTP routes', () => {
  let http: Server | undefined;
  afterEach(async () => {
    await new Promise((r) => http?.close(r));
    http = undefined;
  });

  async function serve() {
    const seen: { id: number; body: unknown }[] = [];
    http = createHttpServer({
      now: Date.now,
      startedAt: 0,
      internalSecret: 's3cret',
      classRooms: {
        status: (id) => ({ state: id === 1 ? 'live' : 'waiting', port: 9001 }),
        handle: async (id, body) => {
          seen.push({ id, body });
          return { ok: true, status: { state: 'live', port: 9001 } };
        },
      },
    });
    await new Promise<void>((r) => (http as Server).listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${((http as Server).address() as AddressInfo).port}`, seen };
  }

  it('reads status and sends commands with the secret', async () => {
    const { url, seen } = await serve();
    const control = new HttpGameControl(url, 's3cret');
    expect(await control.status(1)).toMatchObject({ state: 'live', port: 9001 });
    expect(await control.command(1, { action: 'kick', accountId: 4 })).toMatchObject({ ok: true });
    expect(seen).toEqual([{ id: 1, body: { action: 'kick', accountId: 4 } }]);
  });

  it('is refused with the wrong secret, and reports an unreachable server instead of throwing', async () => {
    const { url } = await serve();
    expect(await new HttpGameControl(url, 'wrong').command(1, { action: 'start' })).toEqual({
      ok: false,
      reason: 'game_server_error',
    });
    const dead = createServer();
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r));
    const deadUrl = `http://127.0.0.1:${(dead.address() as AddressInfo).port}`;
    await new Promise((r) => dead.close(r));
    expect(await new HttpGameControl(deadUrl, 's').command(1, { action: 'start' })).toEqual({
      ok: false,
      reason: 'game_server_unreachable',
    });
    expect(await new HttpGameControl(deadUrl, 's').status(1)).toBeUndefined();
  });
});

describe('class results API (14.9)', () => {
  const result = {
    number: 1,
    startedAt: Date.parse('2026-03-01T10:00:00Z'),
    endedAt: Date.parse('2026-03-01T10:15:00Z'),
    standings: [
      { rank: 1, name: 'Ana', banked: 9000, kills: 4, deaths: 1 },
      { rank: 2, name: 'Ben', banked: 3000, kills: 1, deaths: 2 },
    ],
    awards: [],
  };

  it('lists a class’s finished rounds and one round’s table, only for its teacher', async () => {
    const { h, id } = await boot(new FakeGame());
    expect(
      (await h.client.get<{ rounds: unknown[] }>(`/api/classes/${id}/results`)).body.rounds,
    ).toEqual([]);
    const stored = await h.stores.classResults.record(id, result);
    const list = await h.client.get<{
      rounds: { number: number; players: number; winner: { name: string } }[];
    }>(`/api/classes/${id}/results`);
    expect(list.body.rounds).toMatchObject([{ number: 1, players: 2, winner: { name: 'Ana' } }]);
    const detail = await h.client.get<{ standings: { name: string; banked: number }[] }>(
      `/api/classes/${id}/results/${stored.id}`,
    );
    expect(detail.body.standings.map((s) => [s.name, s.banked])).toEqual([
      ['Ana', 9000],
      ['Ben', 3000],
    ]);
    expect((await h.client.get(`/api/classes/${id}/results/99`)).status).toBe(404);
    h.client.clearCookie();
    await h.loginAs('bob@school.test', 'teacher');
    expect((await h.client.get(`/api/classes/${id}/results`)).status).toBe(403);
    expect((await h.client.get(`/api/classes/${id}/results/${stored.id}`)).status).toBe(403);
  });
  it('hands the teacher the recording of a round, and says so when there is none (35.2)', async () => {
    const { h, id } = await boot(new FakeGame());
    const replay = { step: 3, seconds: 6, tracks: [], events: [] };
    const withReplay = await h.stores.classResults.record(id, { ...result, replay });
    const without = await h.stores.classResults.record(id, { ...result, number: 2 });
    const list = await h.client.get<{ rounds: { id: number; hasReplay: boolean }[] }>(
      `/api/classes/${id}/results`,
    );
    expect(list.body.rounds.map((r) => [r.id, r.hasReplay])).toEqual([
      [without.id, false],
      [withReplay.id, true],
    ]);
    expect((await h.client.get(`/api/classes/${id}/results/${withReplay.id}/replay`)).body).toEqual(
      replay,
    );
    expect((await h.client.get(`/api/classes/${id}/results/${without.id}/replay`)).status).toBe(
      404,
    );
    h.client.clearCookie();
    await h.loginAs('bob@school.test', 'teacher');
    expect((await h.client.get(`/api/classes/${id}/results/${withReplay.id}/replay`)).status).toBe(
      403,
    );
  });
});
