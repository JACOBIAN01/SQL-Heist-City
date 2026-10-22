import { SQUAD_ROLES, type SquadMessage, type SquadRole } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { clear, h } from '../dom';
import '../profile/skills.css';

/** What a task's reward key means to a squad-mate reading it. */
export function taskKey(rewardKey: string): MessageKey {
  const family = rewardKey.split(':')[0];
  return family === 'vault' || family === 'heal' || family === 'gun' || family === 'ammo'
    ? (`squad.task.${family}` as MessageKey)
    : 'squad.task.other';
}

/**
 * Squads in the match (Phase 27): a small always-on list of squad-mates (health, role, what they
 * are solving) and a panel to pick a squad and a role. The server decides everything; this only
 * shows what it sent and asks.
 */
export class SquadView {
  /** The compact squad-mate list on the HUD. */
  readonly hud = h('div', { class: 'squad-hud', attrs: { 'data-role': 'squad-hud', hidden: '' } });
  /** The panel (opened with a key). */
  readonly panel = h('section', {
    class: 'skills squad-panel',
    attrs: { 'data-role': 'squad', role: 'dialog', hidden: '' },
  });
  private last: SquadMessage | undefined;

  constructor(
    private readonly i18n: I18n,
    private readonly send: (
      message: { t: 'squad_join'; squad: number } | { t: 'role_pick'; role: SquadRole | null },
    ) => void,
  ) {
    i18n.onChange(() => this.draw());
    this.draw();
  }

  get hidden(): boolean {
    return Boolean(this.panel.hidden);
  }

  set hidden(value: boolean) {
    this.panel.hidden = value;
  }

  /** Squad-mates (and their positions) for the minimap. */
  get members(): SquadMessage['members'] {
    return this.last?.members ?? [];
  }

  update(message: SquadMessage): void {
    this.last = message;
    this.draw();
  }

  private t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  private draw(): void {
    const m = this.last;
    this.drawHud(m);
    clear(this.panel);
    this.panel.setAttribute('aria-label', this.t('squad.title'));
    this.panel.appendChild(
      h(
        'header',
        { class: 'skills-head' },
        h('h2', { text: this.t('squad.title') }),
        h('button', { text: this.t('squad.close'), on: { click: () => (this.hidden = true) } }),
      ),
    );
    if (!m) {
      this.panel.appendChild(h('p', { class: 'skills-help', text: this.t('squad.none') }));
      return;
    }
    this.panel.appendChild(
      h('p', {
        class: 'skills-help',
        text: m.squad > 0 ? this.t('squad.yours', { name: m.name }) : this.t('squad.none'),
        attrs: { role: 'status' },
      }),
    );
    if (m.denied)
      this.panel.appendChild(
        h('p', {
          class: 'menu-error',
          text: this.t(`squad.denied.${m.denied}` as MessageKey),
          attrs: { role: 'alert' },
        }),
      );
    if (m.mode === 'self') this.pickSection(m);
    else
      this.panel.appendChild(
        h('p', {
          class: 'skills-help',
          text: this.t(m.mode === 'auto' ? 'squad.auto' : 'squad.teacher'),
        }),
      );
    if (m.squad > 0) {
      this.panel.append(
        h('h3', { text: this.t('squad.members') }),
        h('ul', { class: 'squad-members' }, ...m.members.map((x) => this.memberLine(x))),
        h('h3', { text: this.t('squad.rolesTitle') }),
        h('p', { class: 'skills-help', text: this.t('squad.rolesHelp') }),
        h('ul', { class: 'squad-roles' }, ...SQUAD_ROLES.map((r) => this.roleLine(m, r))),
      );
    }
  }

  private pickSection(m: SquadMessage): void {
    this.panel.appendChild(
      h('p', { class: 'skills-help', text: this.t('squad.pickHelp', { size: m.size }) }),
    );
    const buttons = m.choices.map((c) =>
      h('button', {
        text:
          c.full && c.squad !== m.squad
            ? this.t('squad.full', { name: c.name })
            : this.t('squad.join', { name: c.name, members: c.members, size: m.size }),
        attrs: {
          type: 'button',
          'aria-pressed': String(c.squad === m.squad),
          ...(!m.canPick || (c.full && c.squad !== m.squad) ? { disabled: '' } : {}),
        },
        on: { click: () => this.send({ t: 'squad_join', squad: c.squad }) },
      }),
    );
    this.panel.appendChild(h('div', { class: 'squad-choices' }, ...buttons));
    if (m.squad > 0 && m.canPick)
      this.panel.appendChild(
        h('button', {
          text: this.t('squad.leave'),
          attrs: { type: 'button' },
          on: { click: () => this.send({ t: 'squad_join', squad: 0 }) },
        }),
      );
  }

  private roleLine(m: SquadMessage, role: SquadRole): HTMLElement {
    const info = m.roles.find((r) => r.role === role);
    const mine = m.role === role;
    const taken = info?.takenBy ?? null;
    return h(
      'li',
      { attrs: { 'data-role-name': role } },
      h('strong', { text: this.t(`squad.role.${role}` as MessageKey) }),
      ` — ${this.t(`squad.perk.${role}` as MessageKey)} `,
      taken
        ? h('span', { class: 'skills-progress', text: this.t('squad.takenBy', { name: taken }) })
        : h('button', {
            text: this.t(mine ? 'squad.giveUp' : 'squad.takeRole', {
              role: this.t(`squad.role.${role}` as MessageKey),
            }),
            attrs: { type: 'button', 'aria-pressed': String(mine) },
            on: { click: () => this.send({ t: 'role_pick', role: mine ? null : role }) },
          }),
    );
  }

  private memberLine(x: SquadMessage['members'][number]): HTMLElement {
    const text = [
      x.you ? `${x.name} (you)` : x.name,
      x.role ? this.t(`squad.role.${x.role}` as MessageKey) : null,
      x.alive ? this.t('squad.hp', { hp: x.hp }) : this.t('squad.down'),
      x.task ? this.t(taskKey(x.task)) : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return h('li', { text });
  }

  /** The always-visible list: a line per squad-mate with a health bar. */
  private drawHud(m: SquadMessage | undefined): void {
    clear(this.hud);
    const mates = (m?.members ?? []).filter((x) => !x.you);
    this.hud.hidden = !m || m.squad === 0 || mates.length === 0;
    if (this.hud.hidden || !m) return;
    this.hud.setAttribute('role', 'group');
    this.hud.setAttribute('aria-label', m.name);
    this.hud.appendChild(h('div', { class: 'squad-hud-title', text: m.name }));
    for (const x of mates) {
      const bar = h(
        'div',
        {
          class: 'squad-hp',
          attrs: {
            role: 'img',
            'aria-label': x.alive ? this.t('squad.hp', { hp: x.hp }) : this.t('squad.down'),
          },
        },
        h('div', { class: 'squad-hp-fill' }),
      );
      (bar.firstElementChild as HTMLElement).style.width =
        `${x.alive ? Math.max(0, Math.min(100, x.hp)) : 0}%`;
      this.hud.appendChild(
        h(
          'div',
          { class: `squad-mate${x.alive ? '' : ' down'}`, attrs: { 'data-mate': String(x.id) } },
          h('span', { class: 'squad-mate-name', text: x.name }),
          h('span', {
            class: 'squad-mate-role',
            text: x.role ? this.t(`squad.role.${x.role}` as MessageKey) : '',
          }),
          bar,
          h('span', { class: 'squad-mate-task', text: x.task ? this.t(taskKey(x.task)) : '' }),
        ),
      );
    }
  }
}
