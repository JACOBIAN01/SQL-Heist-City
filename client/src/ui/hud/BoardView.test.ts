import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18n } from '../../i18n/I18n';
import { BoardView } from './BoardView';

afterEach(() => document.body.replaceChildren());

describe('BoardView', () => {
  it('lists the contracts offered and asks for the one chosen, then closes', () => {
    const send = vi.fn();
    const v = new BoardView(new I18n('en'), send);
    document.body.append(v.panel);
    expect(v.hidden).toBe(true);
    v.open('docks:board', ['delivery', 'sabotage', 'escort']);
    expect(v.hidden).toBe(false);
    expect(v.panel.querySelectorAll('article')).toHaveLength(3);
    v.panel.querySelector<HTMLButtonElement>('[data-kind="sabotage"]')?.click();
    expect(send).toHaveBeenCalledWith({ t: 'job_take', board: 'docks:board', kind: 'sabotage' });
    expect(v.hidden).toBe(true);
  });

  it('has words for every kind of contract', () => {
    const v = new BoardView(new I18n('en'), vi.fn());
    v.open('b', ['delivery', 'race', 'intel', 'sabotage', 'data_theft', 'escort']);
    expect(v.panel.textContent).not.toMatch(/board\.[a-z_]+/);
  });
});
