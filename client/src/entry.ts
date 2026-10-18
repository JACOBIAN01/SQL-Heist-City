import { HttpAccountApi } from './net/account';
import { serverAddressFor } from './net/serverAddress';
import { roomStatus } from './net/classRoom';
import { ErrorReporter, postReport } from './errors/ErrorReporter';
import { MainMenu } from './ui/menu/MainMenu';
import { SettingsPanel } from './ui/settings/SettingsPanel';
import { startSettings } from './settings/bootstrap';

/**
 * The page's front door. With no address parameters it shows the main menu;
 * any parameter (?play, ?tutorial, ?map=… and the debugging flags) goes
 * straight to the game, so every developer workflow keeps working.
 */
const params = new URLSearchParams(location.search);
const server = serverAddressFor(location, params);

// Errors in the browser reach the game server's log (Phase 20.5), from every page the entry loads.
new ErrorReporter({
  send: postReport(server.http('')),
  page: () => location.pathname,
  userAgent: navigator.userAgent,
}).install(window);
const wantsPractice = params.has('practice');
const wantsAssessment = params.has('assess');
const onlyAnError = [...params.keys()].every((k) => k === 'signin_error');

if (wantsAssessment) {
  await import('./assess');
} else if (wantsPractice) {
  await import('./practice');
} else if (onlyAnError) {
  const account = new HttpAccountApi(server.account());
  const { store, i18n } = startSettings(account);
  const settingsPanel = new SettingsPanel(store, i18n);
  void new MainMenu({
    account,
    i18n,
    openSettings: () => settingsPanel.open(),
    go: (destination) => {
      location.search =
        destination === 'play' ? '?play' : destination === 'practice' ? '?practice' : '?tutorial';
    },
    navigate: (url) => location.assign(url),
    roomStatus: (classId) => roomStatus(server, classId),
    goAssess: (classId, kind) => {
      location.search = `?assess=${classId}&kind=${kind}`;
    },
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
