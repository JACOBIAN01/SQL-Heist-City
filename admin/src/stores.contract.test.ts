import { afterAll, describe, expect, it } from 'vitest';
import { questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { openDatabase } from '@heist/server/db/database';
import { TEST_DATABASE_URL, freshPg } from '@heist/server/pg/testing';
import { pgStores, sqliteStores, type AdminStores } from './stores';
import { DuplicateEmailError } from './auth/UserRepository';
import { DuplicatePoolNameError, UnknownQuestionsError } from './pools/PoolRepository';

// SOLID: L (Liskov) — Why: SQLite and PostgreSQL stores run the same suite, so the
// admin behaves the same on either database.
const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

const implementations: [string, () => Promise<AdminStores>][] = [
  ['sqliteStores', async () => sqliteStores(openDatabase({ path: ':memory:' }))],
  ...(TEST_DATABASE_URL
    ? [
        [
          'pgStores',
          async () => {
            const { db, drop } = await freshPg();
            drops.push(drop);
            return pgStores(db);
          },
        ] as [string, () => Promise<AdminStores>],
      ]
    : []),
];

describe.each(implementations)('%s', (_name, make) => {
  describe('users', () => {
    it('creates, finds by email without regard to case, lists, counts and updates', async () => {
      const { users } = await make();
      expect(await users.count()).toBe(0);
      const ana = await users.create({
        email: 'Ana@School.test',
        passwordHash: 'h',
        role: 'teacher',
      });
      expect(ana).toMatchObject({ email: 'ana@school.test', role: 'teacher', disabled: false });
      expect((await users.findByEmail('ANA@school.TEST'))?.passwordHash).toBe('h');
      expect((await users.findById(ana.id))?.email).toBe('ana@school.test');
      expect(await users.count()).toBe(1);
      expect(
        await users.update(ana.id, { role: 'admin', disabled: true, passwordHash: 'h2' }),
      ).toMatchObject({ role: 'admin', disabled: true });
      expect((await users.findById(ana.id))?.passwordHash).toBe('h2');
      expect((await users.list()).map((u) => u.email)).toEqual(['ana@school.test']);
      expect(await users.update(999, { role: 'admin' })).toBeUndefined();
    });

    it('refuses a second account for the same email', async () => {
      const { users } = await make();
      await users.create({ email: 'a@x.test', passwordHash: 'h', role: 'admin' });
      await expect(
        users.create({ email: 'A@X.test', passwordHash: 'h', role: 'admin' }),
      ).rejects.toThrow(DuplicateEmailError);
    });
  });

  describe('sessions', () => {
    it('opens, expires, revokes one and revokes all of a user', async () => {
      const stores = await make();
      const u = await stores.users.create({ email: 's@x.test', passwordHash: 'h', role: 'admin' });
      let now = 1_000;
      const sessions = stores.sessions(500, () => now);
      const a = await sessions.create(u.id);
      const b = await sessions.create(u.id);
      expect(await sessions.userIdFor(a)).toBe(u.id);
      expect(await sessions.userIdFor('nope')).toBeUndefined();
      await sessions.revoke(a);
      expect(await sessions.userIdFor(a)).toBeUndefined();
      expect(await sessions.userIdFor(b)).toBe(u.id);
      now += 600;
      expect(await sessions.userIdFor(b)).toBeUndefined();
      const c = await sessions.create(u.id);
      await sessions.revokeAllFor(u.id);
      expect(await sessions.userIdFor(c)).toBeUndefined();
    });
  });

  describe('audit log', () => {
    it('records entries and lists them newest first with filters and paging', async () => {
      const { audit } = await make();
      const rec = (entityId: string) =>
        audit.record({
          userId: null,
          actor: 'a@x.test',
          action: 'update',
          entity: 'settings',
          entityId,
          detail: { n: entityId },
        });
      await rec('one');
      await rec('two');
      await audit.record({
        userId: null,
        actor: null,
        action: 'create',
        entity: 'pool',
        entityId: '3',
        detail: null,
      });
      const all = await audit.list();
      expect(all.map((e) => e.entityId)).toEqual(['3', 'two', 'one']);
      expect(all[1]?.detail).toEqual({ n: 'two' });
      expect((await audit.list({ entity: 'settings' })).map((e) => e.entityId)).toEqual([
        'two',
        'one',
      ]);
      expect((await audit.list({ entityId: 'one' })).length).toBe(1);
      await audit.scrubDetail('settings', 'one');
      expect((await audit.list({ entityId: 'one' }))[0]).toMatchObject({
        action: 'update',
        detail: null,
      });
      expect((await audit.list({ entityId: 'two' }))[0]?.detail).toEqual({ n: 'two' });
      const page = await audit.list({ before: all[0]?.id as number, limit: 1 });
      expect(page.map((e) => e.entityId)).toEqual(['two']);
    });
  });

  describe('pools', () => {
    const template = (slug: string) => ({ ...questionTemplateSchema.parse(sampleQuestion), slug });

    it('creates, reads, updates and removes a pool of questions', async () => {
      const stores = await make();
      const q1 = await stores.questions.create(template('q1'), null);
      const q2 = await stores.questions.create(template('q2'), null);
      const pool = await stores.pools.create(
        { name: 'Week 3', description: 'joins', questionIds: [q2.id, q1.id, q1.id] },
        'a@x.test',
      );
      expect(pool).toMatchObject({
        name: 'Week 3',
        questionIds: [q1.id, q2.id],
        createdBy: 'a@x.test',
      });
      expect((await stores.pools.list()).map((p) => p.name)).toEqual(['Week 3']);
      const updated = await stores.pools.update(pool.id, {
        name: 'Week 4',
        description: '',
        questionIds: [q2.id],
      });
      expect(updated).toMatchObject({ name: 'Week 4', questionIds: [q2.id] });
      expect(
        await stores.pools.update(999, { name: 'x', description: '', questionIds: [] }),
      ).toBeUndefined();
      expect(await stores.pools.remove(pool.id)).toBe(true);
      expect(await stores.pools.remove(pool.id)).toBe(false);
      expect(await stores.pools.get(pool.id)).toBeUndefined();
    });

    it('refuses duplicate names (any case) and unknown questions', async () => {
      const stores = await make();
      await stores.pools.create({ name: 'Intro', description: '', questionIds: [] }, 'a');
      await expect(
        stores.pools.create({ name: 'intro', description: '', questionIds: [] }, 'a'),
      ).rejects.toThrow(DuplicatePoolNameError);
      await expect(
        stores.pools.create({ name: 'Other', description: '', questionIds: [404] }, 'a'),
      ).rejects.toThrow(UnknownQuestionsError);
      expect((await stores.pools.list()).map((p) => p.name)).toEqual(['Intro']);
    });
  });
});
