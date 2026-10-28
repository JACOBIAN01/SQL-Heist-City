import { describe, expect, it } from 'vitest';
import { DEFAULT_CHEAT_SETTINGS, type CheatSettings } from '@heist/shared';
import { CheatGate, type CheatContext } from './CheatGate';

const base: CheatSettings = { ...DEFAULT_CHEAT_SETTINGS, scope: 'all', codeHash: 'h' };

function gate(over: Partial<CheatSettings> = {}, dev = true) {
  let clock = 1_000_000;
  const settings = { ...base, ...over };
  const g = new CheatGate(
    () => settings,
    () => clock,
    dev,
    async (code) => code === 'right',
  );
  return { g, advance: (ms: number) => (clock += ms), settings };
}
const here: CheatContext = { tutorial: false, classId: 4, round: 1 };

describe('CheatGate scope', () => {
  it('works nowhere when off or when no code is set', async () => {
    expect((await gate({ scope: 'off' }).g.check('p', 'right', here)).ok).toBe(false);
    expect((await gate({ codeHash: '' }).g.check('p', 'right', here)).ok).toBe(false);
  });
  it('dev scope works only outside production', async () => {
    expect((await gate({ scope: 'dev' }, true).g.check('p', 'right', here)).ok).toBe(true);
    expect((await gate({ scope: 'dev' }, false).g.check('p', 'right', here)).ok).toBe(false);
  });
  it('tutorial scope works only in the tutorial', async () => {
    const t = gate({ scope: 'tutorial' });
    expect((await t.g.check('p', 'right', here)).ok).toBe(false);
    expect((await t.g.check('q', 'right', { tutorial: true })).ok).toBe(true);
  });
  it('rooms scope works only in the listed classes', async () => {
    const r = gate({ scope: 'rooms', classIds: [4] });
    expect((await r.g.check('p', 'right', here)).ok).toBe(true);
    expect((await r.g.check('q', 'right', { ...here, classId: 5 })).ok).toBe(false);
    expect((await r.g.check('r', 'right', { tutorial: false })).ok).toBe(false);
    expect(r.g.available(here)).toBe(true);
    expect(r.g.available({ ...here, classId: 5 })).toBe(false);
  });
});

describe('CheatGate limits', () => {
  it('waits at least a second between tries', async () => {
    const t = gate();
    expect((await t.g.check('p', 'bad', here)).ok).toBe(false);
    expect(await t.g.check('p', 'right', here)).toMatchObject({ reason: 'locked' });
    t.advance(1001);
    expect((await t.g.check('p', 'right', here)).ok).toBe(true);
  });
  it('locks a player after a run of wrong codes, then lets them in', async () => {
    const t = gate({ lockoutTries: 2, lockoutSeconds: 30 });
    expect(await t.g.check('p', 'bad', here)).toMatchObject({ reason: 'wrong' });
    t.advance(1100);
    expect(await t.g.check('p', 'bad', here)).toMatchObject({ reason: 'locked' });
    t.advance(1100);
    expect(await t.g.check('p', 'right', here)).toMatchObject({ reason: 'locked' });
    t.advance(31_000);
    expect((await t.g.check('p', 'right', here)).ok).toBe(true);
  });
  it('locks the whole match when many players guess wrongly together', async () => {
    const t = gate({ lockoutTries: 1, lockoutSeconds: 30 });
    for (let i = 0; i < 5; i++) await t.g.check(`p${i}`, 'bad', here);
    expect(await t.g.check('fresh', 'right', here)).toMatchObject({ reason: 'locked' });
    t.advance(31_000);
    expect((await t.g.check('fresh', 'right', here)).ok).toBe(true);
  });
  it('counts passes per round and starts again each round', async () => {
    const t = gate({ maxPerRound: 1 });
    expect((await t.g.check('p', 'right', here)).ok).toBe(true);
    t.g.used('p');
    t.advance(1100);
    expect(await t.g.check('p', 'right', here)).toMatchObject({ reason: 'limit' });
    t.advance(1100);
    expect((await t.g.check('p', 'right', { ...here, round: 2 })).ok).toBe(true);
  });

  it('checks only a few codes at once, so a crowd cannot tie up the server', async () => {
    let release: () => void = () => {};
    const slow = new Promise<void>((r) => (release = r));
    const settings = { ...base };
    const g = new CheatGate(
      () => settings,
      () => 1_000_000,
      true,
      async () => {
        await slow;
        return false;
      },
    );
    const tries = Array.from({ length: 6 }, (_, i) => g.check(`p${i}`, 'x', here));
    const [fifth, sixth] = await Promise.all([tries[4], tries[5]]);
    expect(fifth).toMatchObject({ reason: 'locked' });
    expect(sixth).toMatchObject({ reason: 'locked' });
    release();
    const done = await Promise.all(tries.slice(0, 4));
    expect(done.every((d) => !d.ok && d.reason === 'wrong')).toBe(true);
  });
});
