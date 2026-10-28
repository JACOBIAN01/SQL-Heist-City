import { afterEach, describe, expect, it, vi } from 'vitest';
import { CITY_TABLES, type CityDbMessage } from '@heist/shared';
import { I18n } from '../../i18n/I18n';
import { CityDbView } from './CityDbView';

afterEach(() => document.body.replaceChildren());

const catalog: CityDbMessage = {
  t: 'citydb',
  tables: CITY_TABLES,
  splits: [],
  requests: [
    {
      id: 'guards-all',
      kind: 'intel',
      tier: 1,
      title: 'Every guard',
      prompt: 'Show where every guard is.',
      tables: ['guards'],
    },
    {
      id: 'cameras-bank-3',
      kind: 'camera',
      tier: 4,
      title: 'Cameras at Metro Capital',
      prompt: 'Switch off the cameras.',
      tables: ['cameras'],
      bank: 'bank-3',
    },
  ],
};

const make = () => {
  const send = vi.fn();
  const v = new CityDbView(new I18n('en'), send);
  document.body.append(v.panel);
  v.update(catalog);
  v.hidden = false;
  return { v, send };
};

const type = (v: CityDbView, sql: string) => {
  const box = v.panel.querySelector<HTMLTextAreaElement>('textarea');
  if (!box) throw new Error('no box');
  box.value = sql;
  box.dispatchEvent(new Event('input'));
};

const pick = (v: CityDbView, id: string) => {
  const picker = v.panel.querySelector<HTMLSelectElement>('[data-role="request-picker"]');
  if (!picker) throw new Error('no picker');
  picker.value = id;
  picker.dispatchEvent(new Event('change'));
};

describe('CityDbView', () => {
  it('says there is nothing to ask before the server sends the requests', () => {
    const v = new CityDbView(new I18n('en'), vi.fn());
    expect(v.panel.textContent).toContain('closed');
  });

  it('lists the requests and the tables of the one chosen', () => {
    const { v } = make();
    expect(v.panel.querySelectorAll('option')).toHaveLength(2);
    expect(v.panel.querySelectorAll('optgroup')).toHaveLength(2);
    expect(v.panel.textContent).toContain('Show where every guard is.');
    expect(v.panel.textContent).toContain('guards(id INTEGER');
    pick(v, 'cameras-bank-3');
    expect(v.panel.textContent).toContain('cameras(id TEXT');
    expect(v.panel.textContent).not.toContain('guards(id INTEGER');
  });

  it('sends the query written for the chosen request, once, until it is answered', () => {
    const { v, send } = make();
    type(v, 'SELECT x, z FROM guards');
    v.panel.querySelector<HTMLButtonElement>('[data-action="run"]')?.click();
    expect(send).toHaveBeenCalledWith({
      t: 'city_query',
      ref: 1,
      request: 'guards-all',
      sql: 'SELECT x, z FROM guards',
    });
    v.panel.querySelector<HTMLButtonElement>('[data-action="run"]')?.click();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not send an empty query', () => {
    const { v, send } = make();
    v.panel.querySelector<HTMLButtonElement>('[data-action="run"]')?.click();
    expect(send).not.toHaveBeenCalled();
  });

  it('says how it went: what a right query did, a hint for a wrong one, and a wait', () => {
    const { v } = make();
    type(v, 'SELECT x, z FROM guards');
    v.panel.querySelector<HTMLButtonElement>('[data-action="run"]')?.click();
    v.answered({
      t: 'city_result',
      ref: 1,
      ok: true,
      request: 'guards-all',
      result: { kind: 'intel', pins: 4, seconds: 20 },
    });
    expect(v.panel.textContent).toContain('4 places');
    v.answered({
      t: 'city_result',
      ref: 2,
      ok: false,
      request: 'guards-all',
      reason: 'wrong',
      feedback: { code: 'row_count', message: 'You returned too many rows.' },
    });
    expect(v.panel.querySelector('[role="alert"]')?.textContent).toContain('too many rows');
    v.answered({
      t: 'city_result',
      ref: 3,
      ok: false,
      request: 'guards-all',
      reason: 'cooldown',
      waitSeconds: 9,
    });
    expect(v.panel.querySelector('[role="alert"]')?.textContent).toContain('9');
  });

  it('keeps what was typed when the request changes back and forth', () => {
    const { v } = make();
    type(v, 'SELECT 1');
    pick(v, 'cameras-bank-3');
    expect(v.panel.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('SELECT 1');
  });
});

describe('CityDbView: split queries (34.2)', () => {
  const withSplit = (v: CityDbView) =>
    v.update({
      ...catalog,
      splits: [
        {
          id: 'split-bank-4',
          tier: 5,
          bank: 'bank-4',
          title: 'The door code, in three parts',
          intro: 'Write your part.',
          tables: ['guards'],
          ctes: ['guard_counts', 'camera_status'],
          parts: [
            { label: 'Part 1: guards', prompt: 'Count the guards.' },
            { label: 'Part 2: cameras', prompt: 'Count the cameras.' },
            { label: 'Part 3: the join', prompt: 'Join them.' },
          ],
        },
      ],
    });

  it('shows the three parts and who has done them, and sends the part chosen', () => {
    const send = vi.fn();
    const v = new CityDbView(new I18n('en'), send);
    document.body.append(v.panel);
    withSplit(v);
    pick(v, 'split:split-bank-4');
    expect(v.panel.querySelectorAll('[data-part]')).toHaveLength(3);
    v.splitState({
      t: 'split_state',
      split: 'split-bank-4',
      parts: [{ status: 'done', by: 'Ana' }, { status: 'open' }, { status: 'open' }],
    });
    expect(v.panel.querySelector('[data-part="0"]')?.textContent).toContain('Ana');
    const which = v.panel.querySelector<HTMLSelectElement>('[data-role="part-picker"]');
    if (!which) throw new Error('no part picker');
    which.value = '2';
    which.dispatchEvent(new Event('change'));
    type(v, 'SELECT 1');
    v.panel.querySelector<HTMLButtonElement>('[data-action="run"]')?.click();
    expect(send).toHaveBeenCalledWith({
      t: 'split_submit',
      ref: 1,
      split: 'split-bank-4',
      part: 2,
      sql: 'SELECT 1',
    });
  });
});
