import { afterAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import {
  InMemoryPlayerRepository,
  InMemoryPlayerSessions,
  PgPlayerRepository,
  PgPlayerSessions,
  type PlayerRepository,
  type PlayerSessions,
} from './PlayerRepository';

const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

type Made = (now: () => number) => Promise<{ players: PlayerRepository; sessions: PlayerSessions }>;
const implementations: [string, Made][] = [
  [
    'in memory',
    async (now) => ({
      players: new InMemoryPlayerRepository(),
      sessions: new InMemoryPlayerSessions(500, now),
    }),
  ],
  ...(TEST_DATABASE_URL
    ? [
        [
          'PostgreSQL',
          async (now: () => number) => {
            const { db, drop } = await freshPg();
            drops.push(drop);
            return {
              players: new PgPlayerRepository(db),
              sessions: new PgPlayerSessions(db, 500, now),
            };
          },
        ] as [string, Made],
      ]
    : []),
];

const ana = { sub: 'g-1', email: 'ana@school.edu', name: 'Ana Silva', domain: 'school.edu' };

describe.each(implementations)('players: %s', (_n, make) => {
  it('creates a player on first sign-in and finds the same one next time', async () => {
    const { players } = await make(Date.now);
    const first = await players.upsertFromGoogle(ana, new Date('2026-01-01T00:00:00Z'));
    expect(first).toMatchObject({
      googleSub: 'g-1',
      displayName: 'Ana Silva',
      schoolDomain: 'school.edu',
    });
    const again = await players.upsertFromGoogle(
      { ...ana, email: 'ana.new@school.edu' },
      new Date('2026-02-01T00:00:00Z'),
    );
    expect(again.id).toBe(first.id);
    expect(again.email).toBe('ana.new@school.edu');
    expect(again.lastSeenAt).toBe('2026-02-01T00:00:00.000Z');
    expect(again.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect((await players.findBySub('g-1'))?.id).toBe(first.id);
    expect((await players.findById(first.id))?.email).toBe('ana.new@school.edu');
    expect(await players.findById(999)).toBeUndefined();
  });

  it('keeps a chosen display name across sign-ins', async () => {
    const { players } = await make(Date.now);
    const p = await players.upsertFromGoogle(ana);
    expect((await players.rename(p.id, 'Ana S.'))?.displayName).toBe('Ana S.');
    expect(
      (await players.upsertFromGoogle({ ...ana, name: 'Changed At Google' })).displayName,
    ).toBe('Ana S.');
    expect(await players.rename(999, 'x')).toBeUndefined();
  });

  it('removes a player', async () => {
    const { players } = await make(Date.now);
    const p = await players.upsertFromGoogle(ana);
    expect(await players.remove(p.id)).toBe(true);
    expect(await players.remove(p.id)).toBe(false);
    expect(await players.findById(p.id)).toBeUndefined();
    expect(await players.findBySub('g-1')).toBeUndefined();
  });

  it('expires and revokes sessions', async () => {
    let now = 1_000;
    const { players, sessions } = await make(() => now);
    const p = await players.upsertFromGoogle(ana);
    const a = await sessions.create(p.id);
    const b = await sessions.create(p.id);
    await sessions.revoke(a);
    expect(await sessions.playerIdFor(a)).toBeUndefined();
    expect(await sessions.playerIdFor('nope')).toBeUndefined();
    now += 600;
    expect(await sessions.playerIdFor(b)).toBeUndefined();
    const c = await sessions.create(p.id);
    await sessions.revokeAllFor(p.id);
    expect(await sessions.playerIdFor(c)).toBeUndefined();
  });
});

describe.skipIf(!TEST_DATABASE_URL)('players: PostgreSQL cascade', () => {
  it('removing a player removes their sessions', async () => {
    const { db, drop } = await freshPg();
    try {
      const players = new PgPlayerRepository(db);
      const sessions = new PgPlayerSessions(db);
      const p = await players.upsertFromGoogle(ana);
      const token = await sessions.create(p.id);
      await players.remove(p.id);
      expect(await sessions.playerIdFor(token)).toBeUndefined();
    } finally {
      await drop();
    }
  });
});
