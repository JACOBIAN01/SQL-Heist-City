import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountApi, WhoAmI } from '../../net/account';
import { MainMenu, type MenuOptions } from './MainMenu';

const ana = {
  id: 1,
  displayName: 'Ana Silva',
  email: 'ana@school.edu',
  schoolDomain: 'school.edu',
};

function menu(who: WhoAmI, over: Partial<MenuOptions> = {}) {
  const signOut = vi.fn(async () => {});
  const account: AccountApi = {
    me: async () => who,
    ticket: async () => undefined,
    signOut,
    rename: async () => ({ error: 'no' }),
    joinClass: vi.fn(async (code: string) =>
      code === 'GOOD22' ? { id: 5, name: '9B SQL' } : { error: 'No class has that code.' },
    ),
    exportData: async () => '{"data":1}',
    deleteAccount: vi.fn(async () => true),
    signInUrl: (to) => `https://acct.test/login?return=${to}`,
    devSignInUrl: (n, to) => `https://acct.test/dev?name=${n}&return=${to}`,
  };
  const go = vi.fn();
  const navigate = vi.fn();
  const m = new MainMenu({
    account,
    go,
    navigate,
    returnTo: 'http://game/',
    allowUnsigned: false,
    ...over,
  });
  return { m, go, navigate, signOut };
}
const buttons = (m: MainMenu) => [...m.root.querySelectorAll('button')].map((b) => b.textContent);
const press = (m: MainMenu, label: string) =>
  [...m.root.querySelectorAll('button')].find((b) => b.textContent === label)?.click();

afterEach(() => document.body.replaceChildren());

describe('MainMenu', () => {
  it('offers Google sign-in when signed out, and nothing that reaches a match', async () => {
    const { m, navigate } = menu({ state: 'signed_out' });
    await m.show();
    expect(buttons(m)).toEqual(['Sign in with Google']);
    press(m, 'Sign in with Google');
    expect(navigate).toHaveBeenCalledWith('https://acct.test/login?return=http://game/');
  });

  it('shows who is signed in and lets them play or take the tutorial', async () => {
    const { m, go } = menu({ state: 'signed_in', player: ana });
    await m.show();
    expect(m.root.textContent).toContain('Ana Silva');
    expect(buttons(m)).toEqual([
      'Save name',
      'Join class',
      'Play (open match)',
      'Tutorial',
      'Practice SQL (solo)',
      'Settings',
      'Download my data',
      'Delete my account',
      'Sign out',
    ]);
    press(m, 'Play (open match)');
    press(m, 'Tutorial');
    expect(go.mock.calls).toEqual([['play'], ['tutorial']]);
    expect(m.root.querySelector('button[disabled]')?.textContent).toBe('Settings');
  });

  it('renames the player and shows why a name was refused', async () => {
    const rename = vi
      .fn()
      .mockResolvedValueOnce({ error: 'That name is not allowed.' })
      .mockResolvedValueOnce({ ...ana, displayName: 'Agent Ana' });
    const { m } = menu({ state: 'signed_in', player: ana }, {});
    (m as unknown as { options: { account: AccountApi } }).options.account.rename = rename;
    await m.show();
    const input = m.root.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('Ana Silva');
    input.value = 'bad';
    press(m, 'Save name');
    await Promise.resolve();
    await Promise.resolve();
    expect(rename).toHaveBeenCalledWith('bad');
    expect(m.root.textContent).toContain('That name is not allowed.');
    press(m, 'Save name');
    await Promise.resolve();
    await Promise.resolve();
    expect(input.value).toBe('Agent Ana');
  });

  it('saves the player’s data as a file', async () => {
    const saveFile = vi.fn();
    const { m } = menu({ state: 'signed_in', player: ana }, { saveFile });
    await m.show();
    press(m, 'Download my data');
    await Promise.resolve();
    await Promise.resolve();
    expect(saveFile).toHaveBeenCalledWith('my-heist-data.json', '{"data":1}');
  });

  it('deletes the account only after the player confirms', async () => {
    const no = menu({ state: 'signed_in', player: ana }, { confirm: () => false });
    await no.m.show();
    press(no.m, 'Delete my account');
    await Promise.resolve();
    expect(buttons(no.m)).toContain('Play (open match)');
    const yes = menu({ state: 'signed_in', player: ana }, { confirm: () => true });
    await yes.m.show();
    press(yes.m, 'Delete my account');
    await new Promise((r) => setTimeout(r, 0));
    expect(buttons(yes.m)).toEqual(['Sign in with Google']);
  });

  it('signs out and returns to the sign-in screen', async () => {
    const { m, signOut } = menu({ state: 'signed_in', player: ana });
    await m.show();
    press(m, 'Sign out');
    await Promise.resolve();
    await Promise.resolve();
    expect(signOut).toHaveBeenCalled();
    expect(buttons(m)).toEqual(['Sign in with Google']);
  });

  it('offers a made-up sign-in only when the page asks for it (development)', async () => {
    const off = menu({ state: 'signed_out' });
    await off.m.show();
    expect(buttons(off.m)).not.toContain('Dev sign-in');
    const on = menu(
      { state: 'signed_out' },
      { devSignInUrl: (n, to) => `https://acct.test/dev?name=${n}&return=${to}` },
    );
    await on.m.show();
    (on.m.root.querySelector('input') as HTMLInputElement).value = 'Tester';
    press(on.m, 'Dev sign-in');
    expect(on.navigate).toHaveBeenCalledWith(
      'https://acct.test/dev?name=Tester&return=http://game/',
    );
  });

  it('says so when the account service is down, and allows unsigned play only in development', async () => {
    const prod = menu({ state: 'unavailable' });
    await prod.m.show();
    expect(prod.m.root.textContent).toContain('not reachable');
    expect(buttons(prod.m)).toEqual([]);
    const dev = menu({ state: 'unavailable' }, { allowUnsigned: true });
    await dev.m.show();
    expect(buttons(dev.m)).toEqual(['Play without signing in (development)', 'Tutorial']);
  });

  it('explains a failed sign-in in plain words, and shows text as text', async () => {
    const { m } = menu({ state: 'signed_out' }, { signInError: 'domain_not_allowed' });
    await m.show();
    expect(m.root.querySelector('.menu-error')?.textContent).toContain('allowed school');
    const evil = menu({
      state: 'signed_in',
      player: { ...ana, displayName: '<img src=x onerror=alert(1)>' },
    });
    await evil.m.show();
    expect(evil.m.root.querySelector('img')).toBeNull();
  });
});

describe('joining a class from the menu', () => {
  const type = (m: MainMenu, code: string) => {
    (m.root.querySelector('input[aria-label="Class code"]') as HTMLInputElement).value = code;
  };

  it('explains a wrong code', async () => {
    const { m } = menu({ state: 'signed_in', player: ana });
    await m.show();
    type(m, 'NOPE');
    press(m, 'Join class');
    await new Promise((r) => setTimeout(r, 0));
    expect(m.root.textContent).toContain('No class has that code.');
  });

  it('waits for the teacher, then goes into the room once it is live', async () => {
    const statuses = [
      { state: 'waiting' as const },
      { state: 'waiting' as const },
      { state: 'live' as const, port: 9001, players: 3, maxPlayers: 100 },
    ];
    const roomStatus = vi.fn(async () => statuses.shift() ?? { state: 'waiting' as const });
    const goClass = vi.fn();
    const { m } = menu({ state: 'signed_in', player: ana }, { roomStatus, goClass, pollMs: 5 });
    await m.show();
    type(m, 'GOOD22');
    press(m, 'Join class');
    await new Promise((r) => setTimeout(r, 0));
    expect(m.root.textContent).toContain('9B SQL');
    expect(m.root.textContent).toContain('Waiting for your teacher');
    await new Promise((r) => setTimeout(r, 60));
    expect(goClass).toHaveBeenCalledWith(5);
    expect(roomStatus).toHaveBeenCalledTimes(3);
  });

  it('lets the student leave the waiting room, and stops looking', async () => {
    const roomStatus = vi.fn(async () => ({ state: 'waiting' as const }));
    const { m } = menu({ state: 'signed_in', player: ana }, { roomStatus, pollMs: 5 });
    await m.show();
    type(m, 'GOOD22');
    press(m, 'Join class');
    await new Promise((r) => setTimeout(r, 20));
    press(m, 'Leave');
    const calls = roomStatus.mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(roomStatus.mock.calls.length).toBe(calls);
    expect(buttons(m)).toContain('Join class');
  });
});
