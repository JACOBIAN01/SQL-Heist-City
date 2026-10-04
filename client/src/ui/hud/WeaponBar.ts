import { WEAPON_IDS } from '@heist/shared';
import { h } from '../dom';
import { rewardIcon } from '../icons/icons';
import { rewardLabel } from '../sql/labels';

/**
 * The guns you own, as icon slots numbered by the key that selects them,
 * with the one in hand lit and its rounds shown. Slots for guns you do not
 * own stay hidden: you earn each one with a question.
 */
export class WeaponBar {
  readonly root: HTMLElement;
  private readonly slots = new Map<string, HTMLElement>();
  private readonly ammo: HTMLElement;
  private readonly name: HTMLElement;

  constructor() {
    this.ammo = h('b', { class: 'hud-ammo', text: '' });
    this.name = h('span', { class: 'hud-weapon-name' });
    const slots = WEAPON_IDS.map((id, i) => {
      const slot = h(
        'div',
        { class: 'hud-slot', attrs: { title: rewardLabel(`gun:${id}`) } },
        h('span', { class: 'hud-slot-key', text: String(i + 1) }),
        rewardIcon(`gun:${id}`),
      );
      slot.hidden = true;
      this.slots.set(id, slot);
      return slot;
    });
    this.root = h(
      'div',
      { class: 'hud-weapons' },
      h('div', { class: 'hud-weapon-line' }, this.name, this.ammo),
      h('div', { class: 'hud-slots' }, ...slots),
    );
    this.root.hidden = true;
  }

  /** The guns owned and the one in hand (empty string = unarmed). */
  setArms(owned: readonly string[], current: string): void {
    for (const [id, slot] of this.slots) {
      slot.hidden = !owned.includes(id);
      slot.classList.toggle('current', id === current);
    }
    this.root.hidden = owned.length === 0;
    this.name.textContent = current ? rewardLabel(`gun:${current}`) : '';
  }

  setAmmo(rounds: number): void {
    this.ammo.textContent = String(rounds);
    this.ammo.dataset.empty = String(rounds <= 0);
  }
}
