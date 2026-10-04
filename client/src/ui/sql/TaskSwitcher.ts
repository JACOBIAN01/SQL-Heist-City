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
  /** Why this task cannot be started right now (shown greyed out); absent when it can. */
  readonly disabled?: string;
}

/** Tasks fixed in advance, or asked for each time the menu opens (the game's situation changes). */
export type TaskSource = readonly TaskOption[] | (() => readonly TaskOption[]);

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
  private currentKey: string | null = null;

  constructor(
    host: HTMLElement,
    private readonly source: TaskSource,
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
    // A live source is read when the menu opens, not now: the game it describes may not exist yet.
    if (typeof source !== 'function') this.render();
    clear(host);
    // A fixed list of one task has nothing to switch to; a live list is always offered.
    if (typeof source === 'function' || source.length > 1) host.append(this.root);

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
    this.currentKey = key;
    this.markCurrent();
  }

  private markCurrent(): void {
    const key = this.currentKey;
    for (const [taskKey, button] of this.buttons) {
      button.setAttribute('aria-current', String(taskKey === key));
    }
  }

  /** Opens the menu (with the tasks that make sense right now). */
  open(): void {
    this.toggle(true);
  }

  private toggle(open = this.menu.hidden): void {
    if (open && typeof this.source === 'function') this.render();
    this.menu.hidden = !open;
    this.trigger.setAttribute('aria-expanded', String(open));
  }

  private render(): void {
    this.menu.replaceChildren();
    this.buttons.clear();
    const tasks = typeof this.source === 'function' ? this.source() : this.source;
    const groups = new Map<string, TaskOption[]>();
    for (const t of tasks) groups.set(t.group, [...(groups.get(t.group) ?? []), t]);
    for (const [group, tasks] of groups) {
      this.menu.append(
        h('div', { class: 'sqlp-menu-group', text: group }),
        h('div', { class: 'sqlp-menu-grid' }, ...tasks.map((task) => this.item(task))),
      );
    }
    this.markCurrent();
  }

  private item(task: TaskOption): HTMLButtonElement {
    const button = h(
      'button',
      {
        class: 'sqlp-item',
        attrs: {
          type: 'button',
          role: 'menuitem',
          'data-key': task.key,
          title: task.disabled ?? task.label,
          ...(task.disabled ? { disabled: '' } : {}),
        },
        on: {
          click: () => {
            this.toggle(false);
            this.onSelect(task);
          },
        },
      },
      rewardIcon(task.key),
      h('span', { class: 'sqlp-item-label', text: task.label }),
      task.disabled ? h('span', { class: 'sqlp-item-why', text: task.disabled }) : null,
    );
    this.buttons.set(task.key, button);
    return button;
  }
}
