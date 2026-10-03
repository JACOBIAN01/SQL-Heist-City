import { describe, expect, it, vi } from 'vitest';
import { TaskSwitcher, type TaskOption } from './TaskSwitcher';

const tasks: TaskOption[] = [
  { key: 'heal:small', label: 'Small heal', group: 'Heal' },
  { key: 'heal:full', label: 'Full heal', group: 'Heal' },
  { key: 'gun:rifle', label: 'Rifle', group: 'Gun' },
];

const setup = () => {
  const host = document.createElement('div');
  document.body.append(host);
  const onSelect = vi.fn();
  const switcher = new TaskSwitcher(host, tasks, onSelect);
  const menu = host.querySelector('.sqlp-menu') as HTMLElement;
  const trigger = host.querySelector('.sqlp-switch') as HTMLButtonElement;
  return { host, onSelect, switcher, menu, trigger };
};

describe('TaskSwitcher', () => {
  it('lists tasks as icon items under group headings, closed at first', () => {
    const { host, menu } = setup();
    expect(menu.hidden).toBe(true);
    expect([...host.querySelectorAll('.sqlp-menu-group')].map((g) => g.textContent)).toEqual([
      'Heal',
      'Gun',
    ]);
    expect(host.querySelectorAll('.sqlp-item')).toHaveLength(3);
    expect(host.querySelector('.sqlp-item svg')).not.toBeNull();
  });

  it('opens from the trigger, reports the chosen task and closes', () => {
    const { host, onSelect, menu, trigger } = setup();
    trigger.click();
    expect(menu.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    (host.querySelector('[data-key="gun:rifle"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith(tasks[2]);
    expect(menu.hidden).toBe(true);
  });

  it('Esc closes only the menu; a click elsewhere closes it too', () => {
    const { host, menu, trigger } = setup();
    const outer = vi.fn();
    host.addEventListener('keydown', outer);
    trigger.click();
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.hidden).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    trigger.click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu.hidden).toBe(true);
  });

  it('marks the current task', () => {
    const { host, switcher } = setup();
    switcher.setCurrent('heal:full');
    expect(host.querySelector('[data-key="heal:full"]')?.getAttribute('aria-current')).toBe('true');
    expect(host.querySelector('[data-key="gun:rifle"]')?.getAttribute('aria-current')).toBe(
      'false',
    );
  });

  it('shows nothing when there is nothing to switch to', () => {
    const host = document.createElement('div');
    new TaskSwitcher(host, [tasks[0] as TaskOption], vi.fn());
    expect(host.querySelector('.sqlp-switch')).toBeNull();
  });
});
