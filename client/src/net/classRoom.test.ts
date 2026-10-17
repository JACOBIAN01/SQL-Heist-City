import { describe, expect, it } from 'vitest';
import { classRoomUrl, roomStatus } from './classRoom';
import { ServerAddress } from './serverAddress';

const dev = new ServerAddress({ protocol: 'http:', hostname: 'h' }, '8080');

const reply = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('roomStatus', () => {
  it('reads a waiting and a live room', async () => {
    expect(await roomStatus(dev, 5, reply({ state: 'waiting' }))).toEqual({
      state: 'waiting',
    });
    expect(
      await roomStatus(dev, 5, reply({ state: 'live', port: 9001, players: 4, maxPlayers: 100 })),
    ).toEqual({ state: 'live', port: 9001, players: 4, maxPlayers: 100 });
  });

  it('says unavailable when the server errors or cannot be reached', async () => {
    expect(await roomStatus(dev, 5, reply({}, 500))).toEqual({ state: 'unavailable' });
    expect(
      await roomStatus(dev, 5, (async () => {
        throw new Error('down');
      }) as unknown as typeof fetch),
    ).toEqual({ state: 'unavailable' });
  });

  it('builds the room socket address', () => {
    expect(
      classRoomUrl(new ServerAddress({ protocol: 'http:', hostname: 'localhost' }, null), 9001),
    ).toBe('ws://localhost:9001/ws/game');
  });
});
