import type { RejectReason } from '@heist/shared';
import type { Player } from '../game/Player';
import type { MatchApi } from './MatchApi';
import type { TaskRule } from './TaskRule';

const GUN_KEY = /^gun:(.+)$/;

/** What a rule needs to change a player's guns (implemented by HeistController). */
export interface ArmsControl {
  giveWeapon(player: Player, id: string): void;
  refillAmmo(player: Player): void;
}

/**
 * `gun:<id>`: solve a question, get that gun with a full magazine. A gun
 * you already hold is refused (the question would be wasted); guns are lost
 * on death, so they are earned again each life.
 */
export class GunRule implements TaskRule {
  constructor(
    private readonly match: MatchApi,
    private readonly arms: ArmsControl,
  ) {}

  handles(rewardKey: string): boolean {
    return GUN_KEY.test(rewardKey);
  }

  check(player: Player, rewardKey: string): RejectReason | undefined {
    const id = GUN_KEY.exec(rewardKey)?.[1];
    if (!id || !this.match.weaponSpec(id)) return 'unknown_reward';
    if (!player.alive || player.arsenal.has(id)) return 'not_allowed';
    return undefined;
  }

  grant(player: Player, rewardKey: string): void {
    const id = GUN_KEY.exec(rewardKey)?.[1];
    if (id && player.alive && this.match.weaponSpec(id)) this.arms.giveWeapon(player, id);
  }
}

/** `ammo:refill`: a full magazine for the gun in hand, allowed only when it is not already full. */
export class AmmoRule implements TaskRule {
  constructor(
    private readonly match: MatchApi,
    private readonly arms: ArmsControl,
  ) {}

  handles(rewardKey: string): boolean {
    return rewardKey === 'ammo:refill';
  }

  check(player: Player): RejectReason | undefined {
    const spec = this.match.weaponSpec(player.weaponId);
    if (!player.alive || !spec || player.ammo >= spec.magSize) return 'not_allowed';
    return undefined;
  }

  grant(player: Player): void {
    if (player.alive) this.arms.refillAmmo(player);
  }
}
