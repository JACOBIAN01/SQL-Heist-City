import { HttpAccountApi, accountBase } from './net/account';
import { roomStatus } from './net/classRoom';
import { MainMenu } from './ui/menu/MainMenu';

/**
 * The page's front door. With no address parameters it shows the main menu;
 * any parameter (?play, ?tutorial, ?map=… and the debugging flags) goes
 * straight to the game, so every developer workflow keeps working.
 */
const params = new URLSearchParams(location.search);
const onlyAnError = [...params.keys()].every((k) => k === 'signin_error');

if (onlyAnError) {
  const account = new HttpAccountApi(accountBase(location.hostname, params.get('account')));
  void new MainMenu({
    account,
    go: (destination) => {
      location.search = destination === 'play' ? '?play' : '?tutorial';
    },
    navigate: (url) => location.assign(url),
    roomStatus: (classId) => roomStatus(location.hostname, params.get('server') ?? '8080', classId),
    goClass: (classId) => {
      location.search = `?class=${classId}`;
    },
    confirm: (message) => window.confirm(message),
    saveFile: (name, text) => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      link.download = name;
      link.click();
      URL.revokeObjectURL(link.href);
    },
    returnTo: `${location.origin}${location.pathname}`,
    allowUnsigned: import.meta.env.DEV,
    ...(import.meta.env.DEV
      ? { devSignInUrl: (n: string, to: string) => account.devSignInUrl(n, to) }
      : {}),
    signInError: params.get('signin_error'),
  }).show();
} else {
  await import('./main');
}
