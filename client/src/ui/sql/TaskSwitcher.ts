import { clear, h } from '../dom';

export interface TaskOption {
  /** Reward key sent to the server, e.g. `heal:small` or `vault:bank-3:lock-1`. */
  readonly key: string;
  readonly label: string;
  /** Group heading in the menu, e.g. "Heal", "Gun", "Vault". */
  readonly group: string;
  /** What the reward applies to (vault id, weapon slot…); echoed back on success. */
  readonly target?: string;
}

/** Header menu to change what you are solving for. Picking a new task gets a new question. */
export class TaskSwitcher {
  private readonly select: HTMLSelectElement;

  constructor(
    host: HTMLElement,
    private readonly tasks: readonly TaskOption[],
    private readonly onSelect: (task: TaskOption) => void,
  ) {
    this.select = h('select', {
      class: 'sqlp-select',
      attrs: { 'aria-label': 'Switch task', title: 'Switching gives you a new question' },
      on: {
        change: () => {
          const task = this.tasks.find((t) => t.key === this.select.value);
          if (task) this.onSelect(task);
        },
      },
    });
    this.render();
    clear(host);
    if (tasks.length > 1) host.append(this.select);
  }

  setCurrent(key: string | null): void {
    this.select.value = key ?? '';
  }

  private render(): void {
    this.select.append(h('option', { text: 'Switch task…', attrs: { value: '', disabled: '' } }));
    const groups = new Map<string, TaskOption[]>();
    for (const t of this.tasks) groups.set(t.group, [...(groups.get(t.group) ?? []), t]);
    for (const [group, tasks] of groups) {
      this.select.append(
        h(
          'optgroup',
          { attrs: { label: group } },
          ...tasks.map((t) => h('option', { text: t.label, attrs: { value: t.key } })),
        ),
      );
    }
  }
}
