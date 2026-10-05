import { describe, expect, it } from 'vitest';
import { chooseGameUrl, tutorialUrl } from './lobby';

const match = (port: number, players = 0) => ({ port, players, maxPlayers: 100 });

describe('chooseGameUrl', () => {
  it('joins the match the lobby says has room', async () => {
    const url = await chooseGameUrl('h', '8080', async () => ({
      matches: [match(9001, 100), match(9002, 10)],
      open: match(9002, 10),
    }));
    expect(url).toBe('ws://h:9002/ws/game');
  });

  it('falls back to the first match when none is open', async () => {
    const url = await chooseGameUrl('h', '8080', async () => ({ matches: [match(9001, 100)] }));
    expect(url).toBe('ws://h:9001/ws/game');
  });

  it('falls back to the lobby port when the lobby is down or empty', async () => {
    expect(
      await chooseGameUrl('h', '8080', async () => {
        throw new Error('offline');
      }),
    ).toBe('ws://h:8080/ws/game');
    expect(await chooseGameUrl('h', '8080', async () => ({ matches: [] }))).toBe(
      'ws://h:8080/ws/game',
    );
  });
});

describe('tutorialUrl', () => {
  it('is the tutorial socket on the lobby server itself', () => {
    expect(tutorialUrl('example.test', '8080')).toBe('ws://example.test:8080/ws/tutorial');
  });
});
