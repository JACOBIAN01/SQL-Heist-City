import { CONSENT_VERSION } from '@heist/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  DEFAULT_CITY_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  classInputSchema,
  decodeServerMessages,
  encodeClientMessage,
  questionTemplateSchema,
  type ProfileMessage,
} from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { issueTicket } from '../auth/ticket';
import { ClassRooms } from '../classes/ClassRooms';
import { PgClassRepository } from '../classes/ClassRepository';
import { openDatabase } from '../db/database';
import { MatchPool } from '../game/MatchPool';
import { syncContent } from '../pg/ContentSnapshot';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import { PgPlayerRepository } from '../players/PlayerRepository';
import { PgQuestionStore } from '../questions/PgQuestionStore';
import { PgProfileStore } from './AttemptStore';
import type { PgDatabase } from '../pg/PgDatabase';

const SECRET = 'live-profile-secret-live-profile';

/** The whole path: a student in a class room answers a question; their radar moves live and the record lands in PostgreSQL. */
describe.skipIf(!TEST_DATABASE_URL)('live profile, end to end (15.2, 15.6, 15.8)', () => {
  let dir: string;
  let pool: MatchPool;
  let pg: PgDatabase;
  let drop: () => Promise<void>;
  let ws: WebSocket | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(joinPath(tmpdir(), 'heist-live-'));
    ({ db: pg, drop } = await freshPg());
  });
  afterEach(async () => {
    ws?.terminate();
    await pool?.stop();
    await drop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('records the attempt, moves the student’s profile, and stores the totals', async () => {
    // A question whose answer never changes, tagged Comprehend / Understand, worth 5 marks.
    const question = await new PgQuestionStore(pg).create(
      questionTemplateSchema.parse({
        ...sampleQuestion,
        slug: 'always-one',
        rcsbe: 'C',
        bloom: 'understand',
        marks: 5,
        story_md: 'Return the number one.',
        params: {},
        reference_sql: 'SELECT 1 AS x',
      }),
      null,
    );
    const players = new PgPlayerRepository(pg);
    const classes = new PgClassRepository(pg);
    const ana = await players.upsertFromGoogle({
      sub: 'g1',
      email: 'ana@school.edu',
      name: 'Ana',
      domain: null,
    });
    const cls = await classes.create(classInputSchema.parse({ name: 'Live' }), null);
    await classes.acceptConsent(cls.id, CONSENT_VERSION, null);
    await classes.addMember(cls.id, ana.id);
    await classes.setQuestions(cls.id, [{ questionId: question.id, usage: 'gun' }]);

    const dbPath = joinPath(dir, 'snapshot.db');
    await syncContent(pg, openDatabase({ path: dbPath }));
    // The worker connects to the same PostgreSQL schema.
    const url = `${TEST_DATABASE_URL}?options=${encodeURIComponent(`-c search_path=${pg.schema}`)}`;

    pool = new MatchPool();
    const rooms = new ClassRooms({
      classes,
      pool,
      matchSettings: { ...DEFAULT_MATCH_SETTINGS, sandboxDummies: 0 },
      extras: () => ({ dbPath, databaseUrl: url, ticketSecret: SECRET, requireTicket: true }),
      city: () => DEFAULT_CITY_SETTINGS,
      heist: () => DEFAULT_HEIST_SETTINGS,
    });
    const started = await rooms.handle(cls.id, { action: 'start' });
    const port = (started.ok && started.status.port) as number;

    const json: { t: string }[] = [];
    ws = new WebSocket(`ws://localhost:${port}/ws/game`);
    ws.on('open', () =>
      ws?.send(
        encodeClientMessage({
          t: 'join',
          protocol: PROTOCOL_VERSION,
          name: 'x',
          ticket: issueTicket(SECRET, { id: ana.id, name: 'Ana', classId: cls.id }),
        }),
      ),
    );
    ws.on('message', (data: Buffer) => {
      for (const m of decodeServerMessages(new Uint8Array(data)))
        if (m.t === 'json') json.push(JSON.parse(m.text) as { t: string });
    });
    const send = (m: object) =>
      ws?.send(encodeClientMessage({ t: 'json', text: JSON.stringify(m) }));
    const until = async (check: () => boolean, ms = 20000) => {
      const end = Date.now() + ms;
      while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
      expect(check()).toBe(true);
    };

    // On joining the student already gets a profile (empty).
    await until(() => json.some((m) => m.t === 'profile'));
    send({ t: 'challenge_request', ref: 1, rewardKey: 'gun:pistol' });
    await until(() => json.some((m) => m.t === 'challenge'));
    const issued = json.find((m) => m.t === 'challenge') as unknown as {
      result: { ok: boolean; challenge: { id: string } };
    };
    expect(issued.result.ok).toBe(true);
    const before = json.filter((m) => m.t === 'profile').length;
    send({
      t: 'challenge_submit',
      ref: 2,
      challengeId: issued.result.challenge.id,
      sql: 'SELECT 1 AS x',
    });
    await until(() => json.filter((m) => m.t === 'profile').length > before);

    const live = json.filter((m) => m.t === 'profile').at(-1) as unknown as ProfileMessage;
    expect(live.moved).toEqual([
      { lens: 'rcsbe', dimension: 'C' },
      { lens: 'bloom', dimension: 'understand' },
    ]);
    expect(live.all.rcsbe.find((a) => a.dimension === 'C')).toMatchObject({
      earned: 5,
      available: 5,
      items: 1,
    });
    expect(live.class?.rcsbe.find((a) => a.dimension === 'C')?.items).toBe(1);

    // The record reaches PostgreSQL (saved in batches, so wait for it).
    const items = async () => pg.query('SELECT * FROM attempt_items');
    for (let i = 0; i < 100 && (await items()).length === 0; i++)
      await new Promise((r) => setTimeout(r, 100));
    const [row] = await items();
    expect(row).toMatchObject({
      rcsbe: 'C',
      bloom: 'understand',
      marks: 5,
      outcome: 'solved',
      counted: true,
    });
    expect(Number(row?.player_id)).toBe(ana.id);
    expect(Number(row?.class_id)).toBe(cls.id);
    const totals = await new PgProfileStore(pg).load(ana.id, { kind: 'class', classId: cls.id });
    expect(totals.rcsbe.C).toEqual({ earned: 5, available: 5, items: 1 });
    const events = await pg.query('SELECT kind FROM attempt_events ORDER BY id');
    expect(events.map((e) => e.kind)).toEqual(['issued', 'submit_correct']);
  }, 90000);
});
