import { describe, expect, it } from 'vitest';
import { InMemoryPlayerRepository, InMemoryPlayerSessions, type Player } from './PlayerRepository';
import { PersonalDataRegistry, accountSource } from './PersonalData';

async function setup() {
  const players = new InMemoryPlayerRepository();
  const sessions = new InMemoryPlayerSessions();
  const player = await players.upsertFromGoogle({
    sub: 'g1',
    email: 'ana@school.edu',
    name: 'Ana',
    domain: 'school.edu',
  });
  const registry = new PersonalDataRegistry().register(accountSource(players, sessions));
  return { players, sessions, player, registry };
}

describe('PersonalDataRegistry', () => {
  it('exports every source under its name', async () => {
    const { registry, player } = await setup();
    registry.register({
      name: 'attempts',
      export: async (p: Player) => [{ player: p.id, question: 'q1' }],
      erase: async () => {},
    });
    const data = await registry.exportAll(player);
    expect(Object.keys(data)).toEqual(['account', 'attempts']);
    expect(data.account).toMatchObject({ email: 'ana@school.edu', googleSubject: 'g1' });
    expect(data.attempts).toEqual([{ player: player.id, question: 'q1' }]);
  });

  it('erases from every source, and the account is gone with its sessions', async () => {
    const { registry, player, players, sessions } = await setup();
    const erased: string[] = [];
    registry.register({
      name: 'extra',
      export: async () => ({}),
      erase: async () => void erased.push('extra'),
    });
    const token = await sessions.create(player.id);
    await registry.eraseAll(player);
    expect(erased).toEqual(['extra']);
    expect(await players.findById(player.id)).toBeUndefined();
    expect(await sessions.playerIdFor(token)).toBeUndefined();
  });

  it('refuses two sources with one name', async () => {
    const { registry } = await setup();
    expect(() =>
      registry.register(
        accountSource(new InMemoryPlayerRepository(), new InMemoryPlayerSessions()),
      ),
    ).toThrow(/already registered/);
  });
});
