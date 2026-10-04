import { WEAPON_IDS } from '@heist/shared';
import type { TaskOption } from '../ui/sql/TaskSwitcher';
import { rewardLabel } from '../ui/sql/labels';

/** What the player's situation is, as far as the client knows it (the server still has the last word). */
export interface TaskContext {
  readonly alive: boolean;
  readonly hp: number;
  readonly maxHp: number;
  readonly owned: readonly string[];
  /** Gun in hand, or undefined. */
  readonly weapon: string | undefined;
  readonly ammo: number;
  /** Magazine size of the gun in hand. */
  readonly magSize: number;
  /** A vault whose console is within reach, if any. */
  readonly vault?: {
    readonly id: string;
    readonly tier: number;
    readonly locks: number;
    readonly opened: number;
  };
}

const HEALS = ['small', 'medium', 'full'] as const;

/**
 * The "what do you need?" menu: every task, with the ones that make no sense
 * right now greyed out and a reason. This only saves a wasted question and a
 * round trip: the server checks every request against the real state.
 */
export function buildTaskOptions(ctx: TaskContext): TaskOption[] {
  const dead = ctx.alive ? undefined : 'You are dead';
  const tasks: TaskOption[] = [];

  for (const tier of HEALS) {
    const key = `heal:${tier}`;
    const why = dead ?? (ctx.hp >= ctx.maxHp ? 'Full health' : undefined);
    tasks.push({ key, label: rewardLabel(key), group: 'Heal', ...(why ? { disabled: why } : {}) });
  }

  {
    const why =
      dead ??
      (ctx.weapon === undefined
        ? 'No gun in hand'
        : ctx.ammo >= ctx.magSize
          ? 'Magazine full'
          : undefined);
    tasks.push({
      key: 'ammo:refill',
      label: rewardLabel('ammo:refill'),
      group: 'Ammo',
      ...(why ? { disabled: why } : {}),
    });
  }

  for (const id of WEAPON_IDS) {
    const key = `gun:${id}`;
    const why = dead ?? (ctx.owned.includes(id) ? 'You have it' : undefined);
    tasks.push({ key, label: rewardLabel(key), group: 'Gun', ...(why ? { disabled: why } : {}) });
  }

  const vault = ctx.vault;
  if (vault && vault.opened < vault.locks) {
    const lock = vault.opened + 1;
    const key = `vault:bank-${vault.tier}:lock-${lock}`;
    tasks.push({
      key,
      label: `Lock ${lock} of ${vault.locks}`,
      group: 'Vault',
      target: vault.id,
      ...(dead ? { disabled: dead } : {}),
    });
  } else {
    tasks.push({
      key: 'vault:none',
      label: 'Vault lock',
      group: 'Vault',
      disabled: vault ? 'Already open' : 'Stand at a vault console',
    });
  }
  return tasks;
}
