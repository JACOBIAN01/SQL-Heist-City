import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  DEFAULT_MODES_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
  classInputSchema,
  modeById,
  type ClassRecord,
  type DuelMessage,
} from '@heist/shared';
import { classMatchConfig } from '../classes/ClassMatchConfig';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { ScriptedGateway, correctAnswer } from './testing';

const record: ClassRecord = {
  ...classInputSchema.parse({ name: 'Duel class', playerCap: 60, mode: 'quick-draw' }),
  id: 1,
  code: 'ABCDEF',
  ownerUserId: null,
  locked: false,
  archived: false,
  archivedAt: null,
  consent: null,
  createdAt: '',
  updatedAt: '',
};

function setup() {
  const gateway = new ScriptedGateway();
  const match = new Match({
    map: HEIST_MAP,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 200 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: DEFAULT_HEIST_SETTINGS,
    challenges: gateway,
    classConfig: classMatchConfig(
      record,
      [
        { questionId: 11, usage: 'heal' },
        { questionId: 12, usage: 'gun' },
      ],
      {},
      modeById(DEFAULT_MODES_SETTINGS, 'quick-draw'),
    ),
  });
  const join = (name: string) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, name, connection);
    if (!r.ok) throw new Error('join failed');
    return { player: r.player, connection };
  };
  const seconds = (n: number) => {
    for (let i = 0; i < n * match.tickRate; i++) match.step();
  };
  const last = (c: FakeConnection) => (c.jsonOf('duel') as unknown as DuelMessage[]).at(-1);
  const ask = async (id: number) => {
    match.receiveJson(
      id,
      JSON.stringify({ t: 'challenge_request', ref: 1, rewardKey: 'duel:draw' }),
    );
    await new Promise((r) => setImmediate(r));
  };
  /** The player answers correctly. */
  const solve = async (id: number) => {
    gateway.answer = (raw) => correctAnswer(raw.ref, 'duel:draw');
    match.receiveJson(
      id,
      JSON.stringify({ t: 'challenge_submit', ref: 9, challengeId: 'c', sql: 'x' }),
    );
    await new Promise((r) => setImmediate(r));
  };
  return { match, gateway, join, seconds, last, ask, solve };
}

describe('SQL Quick Draw duels (28.3)', () => {
  it('pairs two students, counts down, then opens a draw for both', () => {
    const { join, seconds, last } = setup();
    const a = join('Ana');
    expect(last(a.connection)).toMatchObject({ state: 'waiting', opponent: null });
    const b = join('Ben');
    expect(last(a.connection)).toMatchObject({
      state: 'countdown',
      opponent: 'Ben',
      you: 0,
      them: 0,
      draw: 1,
      draws: 5,
    });
    expect(last(b.connection)).toMatchObject({ state: 'countdown', opponent: 'Ana' });
    seconds(DEFAULT_MODES_SETTINGS.modes[2]?.duel.countdownSeconds ?? 3);
    const open = last(a.connection);
    expect(open).toMatchObject({ state: 'draw', drawId: 1 });
    expect(last(b.connection)?.drawId).toBe(1);
  });

  it('asks both the very same question from the class’s released set, and only during a draw', async () => {
    const { join, seconds, ask, gateway } = setup();
    const a = join('Ana');
    const b = join('Ben');
    await ask(a.player.id); // still counting down: refused, the gateway is never asked
    expect(gateway.calls).toHaveLength(0);
    seconds(4);
    await ask(a.player.id);
    await ask(b.player.id);
    const [ca, cb] = gateway.calls.map((c) => c.options);
    expect(ca?.shared?.seed).toBeDefined();
    expect(ca?.shared).toEqual(cb?.shared);
    expect([...(ca?.allowedQuestions ?? [])].sort()).toEqual([11, 12]);
    expect(ca?.noHints).toBe(true);
    expect(ca?.shared?.maxTier).toBe(2);
  });

  it('gives the draw, as a shot, to the first correct answer — and a late one counts for nothing', async () => {
    const { join, seconds, solve, last } = setup();
    const a = join('Ana');
    const b = join('Ben');
    seconds(4);
    await solve(a.player.id);
    expect(last(a.connection)).toMatchObject({ state: 'between', you: 1, them: 0, last: 'you' });
    expect(last(b.connection)).toMatchObject({ state: 'between', you: 0, them: 1, last: 'them' });
    expect(a.player.kills).toBe(1);
    expect(b.player.deaths).toBe(1);
    await solve(b.player.id); // too late: the draw is over
    expect(b.player.kills).toBe(0);
    expect(last(b.connection)).toMatchObject({ you: 0, them: 1 });
  });

  it('moves on to the next draw, and a draw nobody solves in time scores for nobody', async () => {
    const { join, seconds, solve, last } = setup();
    const a = join('Ana');
    join('Ben');
    seconds(4);
    await solve(a.player.id);
    seconds(3); // the pause, then a short countdown
    expect(last(a.connection)).toMatchObject({ state: 'countdown', draw: 2 });
    seconds(3);
    expect(last(a.connection)).toMatchObject({ state: 'draw', draw: 2, drawId: 2 });
    // Nobody answers: after the draw's time it ends with a point for nobody.
    for (let i = 0; i < 130 && last(a.connection)?.state === 'draw'; i++) seconds(1);
    expect(last(a.connection)).toMatchObject({ state: 'between', last: 'none', you: 1, them: 0 });
  });

  it('ends the duel when someone has more than half the draws, with the result for each', async () => {
    const { join, seconds, solve, last } = setup();
    const a = join('Ana');
    const b = join('Ben');
    seconds(4);
    for (let draw = 1; draw <= 3; draw++) {
      await solve(a.player.id);
      seconds(3);
      if (draw < 3) seconds(3);
    }
    expect(last(a.connection)).toMatchObject({ state: 'over', result: 'win', you: 3, them: 0 });
    expect(last(b.connection)).toMatchObject({ state: 'over', result: 'lose', you: 0, them: 3 });
    expect(a.player.kills).toBe(3);
  });

  it('gives the duel to the opponent when someone leaves, and puts the other back in the queue', () => {
    const { join, seconds, match, last } = setup();
    const a = join('Ana');
    const b = join('Ben');
    seconds(4);
    match.leave(b.player.id);
    expect(last(a.connection)).toMatchObject({ state: 'over', result: 'win' });
    seconds(5);
    expect(last(a.connection)).toMatchObject({ state: 'waiting', opponent: null });
  });

  it('keeps an odd student waiting, and pairs them with someone new after a duel', async () => {
    const { join, seconds, solve, last } = setup();
    const [a, b, c] = [join('Ana'), join('Ben'), join('Cy')];
    expect(last(c.connection)).toMatchObject({ state: 'waiting' });
    seconds(4);
    for (let i = 0; i < 3; i++) {
      await solve(a.player.id);
      seconds(i < 2 ? 6 : 3);
    }
    seconds(5); // the result is shown, then both go back in the queue
    // Cy was waiting: the next pairing is with them, not straight back to the last opponent.
    expect(last(c.connection)).toMatchObject({ state: 'countdown' });
    const names = [last(a.connection)?.opponent, last(b.connection)?.opponent];
    expect(names.includes('Cy')).toBe(true);
  });

  it('does nothing in a class that is not playing quick draw', () => {
    const match = new Match({
      map: HEIST_MAP,
      settings: DEFAULT_MATCH_SETTINGS,
      combat: DEFAULT_COMBAT_SETTINGS,
      heist: DEFAULT_HEIST_SETTINGS,
      challenges: new ScriptedGateway(),
    });
    const c = new FakeConnection();
    match.join(PROTOCOL_VERSION, 'A', c);
    expect(c.jsonOf('duel')).toEqual([]);
  });

  it('does not end the round early for want of vaults: a duel room plays its whole round', () => {
    const { join, seconds, last } = setup();
    const a = join('Ana');
    join('Ben');
    seconds(130); // longer than the normal 60 s overtime after the last vault is emptied
    expect(last(a.connection)?.state).not.toBe('waiting');
    expect(
      a.connection.jsonOf('round').filter((m) => (m as { phase: string }).phase === 'ended'),
    ).toEqual([]);
  });
});
