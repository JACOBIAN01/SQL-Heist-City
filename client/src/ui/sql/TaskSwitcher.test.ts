import { describe, expect, it, vi } from 'vitest';
import { TaskSwitcher, type TaskOption } from './TaskSwitcher';

const tasks: TaskOption[] = [
  { key: 'heal:small', label: 'Small heal', group: 'Heal' },
  { key: 'heal:full', label: 'Full heal', group: 'Heal' },
  { key: 'gun:rifle', label: 'Rifle', group: 'Gun' },
];

describe('TaskSwitcher', () => {
  it('groups tasks and reports the chosen one', () => {
    const host = document.createElement('div');
    const onSelect = vi.fn();
    const switcher = new TaskSwitcher(host, tasks, onSelect);
    const groups = [...host.querySelectorAll('optgroup')].map((g) => [g.label, g.children.length]);
    expect(groups).toEqual([
      ['Heal', 2],
      ['Gun', 1],
    ]);
    const select = host.querySelector('select') as HTMLSelectElement;
    select.value = 'gun:rifle';
    select.dispatchEvent(new Event('change'));
    expect(onSelect).toHaveBeenCalledWith(tasks[2]);
    switcher.setCurrent('heal:small');
    expect(select.value).toBe('heal:small');
  });

  it('shows nothing when there is nothing to switch to', () => {
    const host = document.createElement('div');
    new TaskSwitcher(host, [tasks[0] as TaskOption], vi.fn());
    expect(host.querySelector('select')).toBeNull();
  });
});
