import { clear, h } from '../dom';
import { rewardIcon } from '../icons/icons';

export interface TaskOption {
  /** Reward key sent to the server, e.g. `heal:small` or `vault:bank-3:lock-1`. */
  readonly key: string;
  readonly label: string;
  /** Group heading in the menu, e.g. "Heal", "Gun", "Vault". */
  readonly group: string;
  /** What the reward applies to (vault id, weapon slot…); echoed back on success. */
  readonly target?: string;
}

/**
 * Header menu to change what you are solving for, shown as an inventory-style
 * icon grid. Picking a new task gets a new question. A custom menu (not a
 * native <select>) because <option> cannot show images.
 */
export class TaskSwitcher {
  private readonly trigger: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private readonly root: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor(
    host: HTMLElement,
    private readonly tasks: readonly TaskOption[],
    private readonly onSelect: (task: TaskOption) => void,
  ) {
    this.trigger = h('button', {
      class: 'sqlp-btn sqlp-switch',
      text: 'Switch ▾',
      attrs: {
        type: 'button',
        'aria-haspopup': 'true',
        'aria-expanded': 'false',
        title: 'Switching gives you a new question',
      },
      on: { click: () => this.toggle() },
    });
    this.menu = h('div', { class: 'sqlp-menu', attrs: { role: 'menu', hidden: '' } });
    this.root = h('span', { class: 'sqlp-switch-wrap' }, this.trigger, this.menu);
    this.render();
    clear(host);
    if (tasks.length > 1) host.append(this.root);

    // Esc closes just the menu (not the whole panel); a click elsewhere closes it too.
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.menu.hidden) return;
      event.stopPropagation();
      this.toggle(false);
      this.trigger.focus();
    });
    document.addEventListener('pointerdown', (event) => {
      if (!this.menu.hidden && !this.root.contains(event.target as Node)) this.toggle(false);
    });
  }

  /** Marks the task in play, so the menu shows where you are. */
  setCurrent(key: string | null): void {
    for (const [taskKey, button] of this.buttons) {
      button.setAttribute('aria-current', String(taskKey === key));
    }
  }

  private toggle(open = this.menu.hidden): void {
    this.menu.hidden = !open;
    this.trigger.setAttribute('aria-expanded', String(open));
  }

  private render(): void {
    const groups = new Map<string, TaskOption[]>();
    for (const t of this.tasks) groups.set(t.group, [...(groups.get(t.group) ?? []), t]);
    for (const [group, tasks] of groups) {
      this.menu.append(
        h('div', { class: 'sqlp-menu-group', text: group }),
        h('div', { class: 'sqlp-menu-grid' }, ...tasks.map((task) => this.item(task))),
      );
    }
  }

  private item(task: TaskOption): HTMLButtonElement {
    const button = h(
      'button',
      {
        class: 'sqlp-item',
        attrs: { type: 'button', role: 'menuitem', 'data-key': task.key, title: task.label },
        on: {
          click: () => {
            this.toggle(false);
            this.onSelect(task);
          },
        },
      },
      rewardIcon(task.key),
      h('span', { class: 'sqlp-item-label', text: task.label }),
    );
    this.buttons.set(task.key, button);
    return button;
  }
}
