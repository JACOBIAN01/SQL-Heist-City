import { describe, expect, it } from 'vitest';
import { ServerAddress, serverAddressFor } from './serverAddress';

const http = { protocol: 'http:', hostname: 'localhost' };
const https = { protocol: 'https:', hostname: 'heist.school.org' };

describe('ServerAddress (20.6)', () => {
  it('in development uses the host with the game server and account service on their own ports', () => {
    const a = new ServerAddress(http, null);
    expect(a.http('/lobby')).toBe('http://localhost:8080/lobby');
    expect(a.ws('/ws/game')).toBe('ws://localhost:8080/ws/game');
    expect(a.matchWs(9001)).toBe('ws://localhost:9001/ws/game');
    expect(a.account()).toBe('http://localhost:8081');
    expect(new ServerAddress(http, '8090').http('/x')).toBe('http://localhost:8090/x');
  });

  it("on an https page goes to the page's own host over https and wss, matches through the server", () => {
    const a = new ServerAddress(https, null);
    expect(a.http('/lobby')).toBe('https://heist.school.org/lobby');
    expect(a.http('')).toBe('https://heist.school.org');
    expect(a.ws('/ws/tutorial')).toBe('wss://heist.school.org/ws/tutorial');
    expect(a.matchWs(41234)).toBe('wss://heist.school.org/at/41234/ws/game');
    expect(a.account()).toBe('https://heist.school.org');
    // The development port is ignored there: nothing listens on 8080 in production.
    expect(new ServerAddress(https, '8080').http('/lobby')).toBe('https://heist.school.org/lobby');
  });

  it('takes a full address for the game server (a page served from a CDN) and one for the account service', () => {
    const a = new ServerAddress(https, 'https://game.school.org', 'https://accounts.school.org');
    expect(a.ws('/ws/game')).toBe('wss://game.school.org/ws/game');
    expect(a.matchWs(5)).toBe('wss://game.school.org/at/5/ws/game');
    expect(a.account()).toBe('https://accounts.school.org');
    const plain = new ServerAddress(http, 'http://10.0.0.5:8080');
    expect(plain.ws('/ws/game')).toBe('ws://10.0.0.5:8080/ws/game');
  });

  it('reads ?server and ?account from the page address', () => {
    const a = serverAddressFor(http, new URLSearchParams('server=9000&account=http://acc.test'));
    expect(a.http('/health')).toBe('http://localhost:9000/health');
    expect(a.account()).toBe('http://acc.test');
  });
});
