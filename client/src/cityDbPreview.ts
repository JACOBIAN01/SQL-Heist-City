import { CITY_TABLES, DEFAULT_CITY_DB_SETTINGS, publicRequests, publicSplits } from '@heist/shared';
import { I18n } from './i18n/I18n';
import { CityDbView } from './ui/hud/CityDbView';

// Development only: the city database terminal with the default requests, for reviews and screenshots.
const i18n = new I18n('en');
const row = document.getElementById('row') as HTMLElement;
const catalog = {
  t: 'citydb' as const,
  tables: CITY_TABLES,
  requests: publicRequests(DEFAULT_CITY_DB_SETTINGS.requests),
  splits: publicSplits(DEFAULT_CITY_DB_SETTINGS.splits),
};

function terminal(request: string, sql: string, answer: Parameters<CityDbView['answered']>[0]) {
  const view = new CityDbView(i18n, () => {});
  view.update(catalog);
  view.hidden = false;
  // Pick the request, type the SQL, run it, and show the server's answer.
  const picker = view.panel.querySelector<HTMLSelectElement>('[data-role="request-picker"]');
  if (picker) {
    picker.value = request;
    picker.dispatchEvent(new Event('change'));
  }
  const box = view.panel.querySelector<HTMLTextAreaElement>('textarea');
  if (box) {
    box.value = sql;
    box.dispatchEvent(new Event('input'));
  }
  view.panel.querySelector<HTMLButtonElement>('[data-action="run"]')?.click();
  view.answered(answer);
  return view;
}

const right = terminal(
  'police-chasing',
  "SELECT p.x, p.z, w.name\nFROM police p\nJOIN wanted w ON w.id = p.target\nWHERE p.role = 'chase'",
  {
    t: 'city_result',
    ref: 1,
    ok: true,
    request: 'police-chasing',
    result: { kind: 'intel', pins: 3, seconds: 45 },
  },
);
const wrong = terminal('cameras-bank-3', 'UPDATE cameras SET enabled = 0', {
  t: 'city_result',
  ref: 1,
  ok: false,
  request: 'cameras-bank-3',
  reason: 'wrong',
  feedback: {
    code: 'row_count',
    message: 'Too many rows changed: your UPDATE touched the cameras of other banks.',
  },
});
row.append(right.panel, wrong.panel);
