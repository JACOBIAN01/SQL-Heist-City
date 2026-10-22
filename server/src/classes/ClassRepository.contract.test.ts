import { afterAll, describe, expect, it } from 'vitest';
import { questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import { PgPlayerRepository } from '../players/PlayerRepository';
import { PgQuestionStore } from '../questions/PgQuestionStore';
import { classInputSchema } from '@heist/shared';
import {
  InMemoryClassRepository,
  PgClassRepository,
  UnknownClassQuestionsError,
  type ClassRepository,
} from './ClassRepository';
import { CODE_LENGTH, isClassCode, newClassCode, normaliseClassCode } from './classCode';

const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

interface Made {
  repo: ClassRepository;
  /** Makes a question that exists (for the question set). */
  question: (slug: string) => Promise<number>;
  player: (sub: string) => Promise<number>;
}

const template = (slug: string) => ({ ...questionTemplateSchema.parse(sampleQuestion), slug });

const implementations: [string, (code?: () => string) => Promise<Made>][] = [
  [
    'in memory',
    async (code) => {
      let n = 0;
      const known = new Set<number>();
      return {
        repo: new InMemoryClassRepository(code, () => known),
        question: async () => (known.add(++n), n),
        player: async () => ++n,
      };
    },
  ],
  ...(TEST_DATABASE_URL
    ? [
        [
          'PostgreSQL',
          async (code?: () => string) => {
            const { db, drop } = await freshPg();
            drops.push(drop);
            const questions = new PgQuestionStore(db);
            const players = new PgPlayerRepository(db);
            return {
              repo: new PgClassRepository(db, code),
              question: async (slug: string) => (await questions.create(template(slug), null)).id,
              player: async (sub: string) =>
                (
                  await players.upsertFromGoogle({
                    sub,
                    email: `${sub}@x.test`,
                    name: sub,
                    domain: null,
                  })
                ).id,
            };
          },
        ] as [string, (code?: () => string) => Promise<Made>],
      ]
    : []),
];

const input = (over: Record<string, unknown> = {}) =>
  classInputSchema.parse({ name: '9B SQL', ...over });

describe('class codes', () => {
  it('are six unambiguous characters, and typed ones are tidied', () => {
    for (let i = 0; i < 200; i++) {
      const code = newClassCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(isClassCode(code)).toBe(true);
      expect(code).not.toMatch(/[0OI1LSZ2]/);
    }
    expect(normaliseClassCode(' ab-c d3e ')).toBe('ABCD3E');
    expect(isClassCode('ABCD3')).toBe(false);
  });
});

describe('class input', () => {
  it('has sensible defaults and keeps the player cap between 60 and 200', () => {
    expect(input()).toMatchObject({
      banksOpen: [1, 2, 3, 4, 5],
      playerCap: 100,
      roundMinutes: null,
      citySeed: null,
    });
    expect(() => input({ playerCap: 59 })).toThrow();
    expect(() => input({ playerCap: 201 })).toThrow();
    expect(input({ banksOpen: [3, 1, 3] }).banksOpen).toEqual([1, 3]);
    expect(() => input({ banksOpen: [6] })).toThrow();
    expect(() => input({ citySeed: 'has space' })).toThrow();
    expect(() => input({ name: '   ' })).toThrow();
  });
});

describe.each(implementations)('classes: %s', (_n, make) => {
  it('creates a class with a code, finds it by code, and updates and archives it', async () => {
    const { repo } = await make();
    const c = await repo.create(input({ citySeed: 'autumn', roundMinutes: 12.5 }), null);
    expect(c).toMatchObject({
      name: '9B SQL',
      citySeed: 'autumn',
      roundMinutes: 12.5,
      dialect: 'sqlite',
      locked: false,
      archived: false,
    });
    expect(isClassCode(c.code)).toBe(true);
    expect((await repo.findByCode(c.code))?.id).toBe(c.id);
    expect(await repo.findByCode('AAAAAA')).toBeUndefined();

    const u = await repo.update(c.id, {
      name: 'Renamed',
      banksOpen: [1, 2],
      playerCap: 80,
      roundMinutes: null,
      dialect: 'postgres',
    });
    expect(u).toMatchObject({
      dialect: 'postgres',
      name: 'Renamed',
      banksOpen: [1, 2],
      playerCap: 80,
      roundMinutes: null,
      citySeed: 'autumn',
    });
    expect(await repo.update(999, { name: 'x' })).toBeUndefined();

    expect((await repo.setLocked(c.id, true))?.locked).toBe(true);
    expect((await repo.archive(c.id))?.archived).toBe(true);
    expect(await repo.list()).toEqual([]);
    expect((await repo.list({ includeArchived: true })).map((x) => x.id)).toEqual([c.id]);
  });

  it('never gives two classes the same code, even when the generator repeats itself', async () => {
    const codes = ['AAAAAA', 'AAAAAA', 'AAAAAA', 'BBBBBB'];
    const { repo } = await make(() => codes.shift() ?? 'CCCCCC');
    const a = await repo.create(input(), null);
    const b = await repo.create(input({ name: 'Other' }), null);
    expect([a.code, b.code]).toEqual(['AAAAAA', 'BBBBBB']);
  });

  it('makes a new code on request, and the old one stops working', async () => {
    const { repo } = await make();
    const c = await repo.create(input(), null);
    const next = await repo.regenerateCode(c.id);
    expect(next?.code).not.toBe(c.code);
    expect(await repo.findByCode(c.code)).toBeUndefined();
    expect((await repo.findByCode(next?.code as string))?.id).toBe(c.id);
    expect(await repo.regenerateCode(999)).toBeUndefined();
  });

  it('lists a teacher’s own classes, newest first', async () => {
    const { repo } = await make();
    const mine1 = await repo.create(input({ name: 'A' }), null);
    await repo.create(input({ name: 'B' }), null);
    expect((await repo.list()).length).toBe(2);
    expect((await repo.list({ ownerUserId: 123 })).length).toBe(0);
    expect((await repo.list())[1]?.id).toBe(mine1.id);
  });

  it('replaces the question set, ignores repeats, and refuses unknown questions', async () => {
    const { repo, question } = await make();
    const c = await repo.create(input(), null);
    const q1 = await question('q1');
    const q2 = await question('q2');
    await repo.setQuestions(c.id, [
      { questionId: q2, usage: 'vault' },
      { questionId: q1, usage: 'heal' },
      { questionId: q1, usage: 'vault' },
      { questionId: q1, usage: 'vault' },
    ]);
    expect(await repo.questions(c.id)).toEqual([
      { questionId: q1, usage: 'heal' },
      { questionId: q1, usage: 'vault' },
      { questionId: q2, usage: 'vault' },
    ]);
    await repo.setQuestions(c.id, [{ questionId: q2, usage: 'gun' }]);
    expect(await repo.questions(c.id)).toEqual([{ questionId: q2, usage: 'gun' }]);
    await expect(repo.setQuestions(c.id, [{ questionId: 9999, usage: 'ammo' }])).rejects.toThrow(
      UnknownClassQuestionsError,
    );
    expect(await repo.questions(c.id)).toEqual([{ questionId: q2, usage: 'gun' }]); // unchanged
  });

  it('records who joined, once each, in order', async () => {
    const { repo, player } = await make();
    const c = await repo.create(input(), null);
    const ana = await player('ana');
    const ben = await player('ben');
    expect(await repo.addMember(c.id, ana, new Date('2026-01-01T10:00:00Z'))).toBe(true);
    expect(await repo.addMember(c.id, ben, new Date('2026-01-01T10:01:00Z'))).toBe(true);
    expect(await repo.addMember(c.id, ana)).toBe(false);
    expect((await repo.members(c.id)).map((m) => m.playerId)).toEqual([ana, ben]);
    expect(await repo.isMember(c.id, ana)).toBe(true);
    expect(await repo.isMember(c.id, 12345)).toBe(false);
  });

  it('keeps squads: off by default, a mode and size that can change, and who is in which', async () => {
    const { repo, player } = await make();
    const c = await repo.create(input(), null);
    expect(c).toMatchObject({ squadMode: 'off', squadSize: 4 });
    expect((await repo.update(c.id, { squadMode: 'self', squadSize: 3 }))?.squadMode).toBe('self');
    expect((await repo.get(c.id))?.squadSize).toBe(3);
    const [ana, ben, cy] = [await player('a1'), await player('b1'), await player('c1')];
    await repo.addMember(c.id, ana);
    await repo.addMember(c.id, ben);
    expect(await repo.squads(c.id)).toEqual({});
    // cy never joined the class, so is left out rather than refused.
    await repo.setSquads(c.id, { [ana]: 1, [ben]: 1, [cy]: 2 });
    expect(await repo.squads(c.id)).toEqual({ [ana]: 1, [ben]: 1 });
    // A new assignment replaces the old one entirely.
    await repo.setSquads(c.id, { [ben]: 2 });
    expect(await repo.squads(c.id)).toEqual({ [ben]: 2 });
  });
});
