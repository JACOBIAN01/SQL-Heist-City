import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SquadMessage } from '@heist/shared';
import { I18n } from '../../i18n/I18n';
import { SquadView, taskKey } from './SquadView';

afterEach(() => document.body.replaceChildren());

const message = (over: Partial<SquadMessage> = {}): SquadMessage => ({
  t: 'squad',
  mode: 'self',
  size: 3,
  squad: 1,
  name: 'Red',
  canPick: true,
  choices: [
    { squad: 1, name: 'Red', members: 2, full: false },
    { squad: 2, name: 'Blue', members: 3, full: true },
  ],
  members: [
    { id: 1, name: 'Ana', hp: 100, alive: true, x: 0, z: 0, task: null, you: true, role: 'hacker' },
    {
      id: 2,
      name: 'Ben',
      hp: 40,
      alive: true,
      x: 5,
      z: 5,
      task: 'heal:small',
      you: false,
      role: null,
    },
    { id: 3, name: 'Cy', hp: 0, alive: false, x: 9, z: 9, task: null, you: false, role: 'lookout' },
  ],
  role: 'hacker',
  roles: [
    { role: 'hacker', takenBy: null },
    { role: 'driver', takenBy: null },
    { role: 'enforcer', takenBy: 'Ben' },
    { role: 'lookout', takenBy: 'Cy' },
  ],
  ...over,
});

const make = () => {
  const sent: object[] = [];
  const v = new SquadView(new I18n('en'), (m) => void sent.push(m));
  document.body.append(v.hud, v.panel);
  return { v, sent };
};
const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === text) as
    HTMLButtonElement | undefined;

describe('SquadView', () => {
  it('shows squad-mates on the HUD with health and what they are solving, but not yourself', () => {
    const { v } = make();
    expect(v.hud.hidden).toBe(true);
    v.update(message());
    expect(v.hud.hidden).toBe(false);
    const text = v.hud.textContent ?? '';
    expect(text).toContain('Red');
    expect(text).toContain('Ben');
    expect(text).toContain('healing');
    expect(text).not.toContain('Ana');
    expect(v.hud.querySelector('[data-mate="3"]')?.classList.contains('down')).toBe(true);
    expect((v.hud.querySelector('[data-mate="2"] .squad-hp-fill') as HTMLElement).style.width).toBe(
      '40%',
    );
  });

  it('is hidden when you are alone or have no squad', () => {
    const { v } = make();
    v.update(message({ squad: 0, name: '', members: [] }));
    expect(v.hud.hidden).toBe(true);
    v.update(message({ members: message().members.slice(0, 1) }));
    expect(v.hud.hidden).toBe(true);
  });

  it('lets a student pick or leave a squad when the class allows, and disables full ones', () => {
    const { v, sent } = make();
    v.update(message({ squad: 0, name: '', members: [], role: null }));
    expect(button(v.panel, 'Blue is full')?.disabled).toBe(true);
    button(v.panel, 'Join Red (2/3)')?.click();
    expect(sent).toEqual([{ t: 'squad_join', squad: 1 }]);
    v.update(message());
    button(v.panel, 'Leave the squad')?.click();
    expect(sent.at(-1)).toEqual({ t: 'squad_join', squad: 0 });
  });

  it('cannot pick once cash is banked, and says why when refused', () => {
    const { v } = make();
    v.update(message({ canPick: false, denied: 'has_banked' }));
    expect(button(v.panel, 'Join Red (2/3)')?.disabled).toBe(true);
    expect(v.panel.querySelector('[role="alert"]')?.textContent).toContain('banked cash');
  });

  it('says how squads were formed when the student cannot pick', () => {
    const { v } = make();
    v.update(message({ mode: 'teacher', choices: [] }));
    expect(v.panel.textContent).toContain('Your teacher puts students in squads.');
    expect(v.panel.querySelector('.squad-choices')).toBeNull();
    v.update(message({ mode: 'auto', choices: [] }));
    expect(v.panel.textContent).toContain('balanced by your teacher');
  });

  it('shows roles with their perks, who has each, and takes or gives up your own', () => {
    const { v, sent } = make();
    v.update(message({ role: null }));
    const row = (r: string) => v.panel.querySelector(`[data-role-name="${r}"]`) as HTMLElement;
    expect(row('hacker').textContent).toContain('Hints cost half');
    expect(row('enforcer').textContent).toContain('taken by Ben');
    expect(row('enforcer').querySelector('button')).toBeNull();
    button(row('driver'), 'Take Driver')?.click();
    expect(sent).toEqual([{ t: 'role_pick', role: 'driver' }]);
    v.update(message()); // you are the hacker now
    button(row('hacker'), 'Give up Hacker')?.click();
    expect(sent.at(-1)).toEqual({ t: 'role_pick', role: null });
  });

  it('lists squad-mates in the panel with role, health and task', () => {
    const { v } = make();
    v.update(message());
    const lines = [...v.panel.querySelectorAll('.squad-members li')].map((li) => li.textContent);
    expect(lines).toEqual([
      'Ana (you) · Hacker · 100 HP',
      'Ben · 40 HP · healing',
      'Cy · Lookout · down',
    ]);
  });

  it('gives the squad-mates’ places to the minimap', () => {
    const { v } = make();
    v.update(message());
    expect(v.members.map((m) => m.name)).toEqual(['Ana', 'Ben', 'Cy']);
  });

  it('names a task by what it is for', () => {
    expect(taskKey('vault:bank-1:lock-2')).toBe('squad.task.vault');
    expect(taskKey('gun:rifle')).toBe('squad.task.gun');
    expect(taskKey('brief:plan')).toBe('squad.task.other');
  });

  it('passes the structural accessibility check', async () => {
    const { v } = make();
    v.hidden = false;
    v.update(message());
    const r = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(r.violations.map((x) => `${x.id}: ${x.nodes[0]?.html.slice(0, 90)}`)).toEqual([]);
    vi.restoreAllMocks();
  });
});
