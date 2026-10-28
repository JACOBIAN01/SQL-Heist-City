import { afterAll, describe, expect, it } from 'vitest';
import { SHARE_CODE, customHeistSpecSchema } from '@heist/shared';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import {
  InMemoryCustomHeistRepository,
  PgCustomHeistRepository,
  type CustomHeistRepository,
} from './CustomHeistRepository';

const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

const impls: [string, () => Promise<CustomHeistRepository>][] = [
  ['in memory', async () => new InMemoryCustomHeistRepository()],
];
if (TEST_DATABASE_URL)
  impls.push([
    'PostgreSQL',
    async () => {
      const { db, drop } = await freshPg();
      drops.push(drop);
      return new PgCustomHeistRepository(db);
    },
  ]);

const spec = (name: string, locks = ['select-all']) => customHeistSpecSchema.parse({ name, locks });

describe.each(impls)('CustomHeistRepository (%s)', (_n, make) => {
  it('saves a heist with a share code, and reads it back by id and by code (any case)', async () => {
    const repo = await make();
    const made = await repo.create(5, spec('Library job'));
    expect(made.shareCode).toMatch(SHARE_CODE);
    expect((await repo.get(made.id))?.spec.name).toBe('Library job');
    expect((await repo.byShareCode(made.shareCode.toLowerCase()))?.id).toBe(made.id);
    expect(await repo.byShareCode('ZZZZZZZZ')).toBeUndefined();
  });

  it('lists a teacher’s own, or everyone’s', async () => {
    const repo = await make();
    await repo.create(1, spec('A'));
    await repo.create(2, spec('B'));
    await repo.create(1, spec('C'));
    expect((await repo.list(1)).map((r) => r.name)).toEqual(['A', 'C']);
    expect(await repo.list()).toHaveLength(3);
  });

  it('changes a heist but keeps its code, and deletes it', async () => {
    const repo = await make();
    const made = await repo.create(1, spec('Old', ['a']));
    const updated = await repo.update(made.id, spec('New', ['a', 'b']));
    expect(updated).toMatchObject({ name: 'New', shareCode: made.shareCode });
    expect(updated?.spec.locks).toEqual(['a', 'b']);
    expect(await repo.remove(made.id)).toBe(true);
    expect(await repo.get(made.id)).toBeUndefined();
    expect(await repo.remove(made.id)).toBe(false);
    expect(await repo.update(made.id, spec('x'))).toBeUndefined();
  });

  it('gives each heist its own share code', async () => {
    const repo = await make();
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) codes.add((await repo.create(1, spec(`H${i}`))).shareCode);
    expect(codes.size).toBe(20);
  });
});
