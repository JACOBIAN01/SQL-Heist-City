import { BANK_LAYOUTS, type FeedItem } from '@heist/shared';
import type { HeistEvent, HeistEvents } from './HeistEvents';
import type { MatchApi } from './MatchApi';

/** A bank's name for the feed ("Metro Capital"), or "Bank 3" for a tier without a layout. */
export const bankName = (tier: number): string => BANK_LAYOUTS.get(tier)?.name ?? `Bank ${tier}`;

/**
 * Turns heist events into lines of the feed every player sees: an alarm when
 * a lock is cracked (ambush bait), a vault opening, cash banked, bounties set
 * and claimed. Who cracked a lock is not said: the alarm tells you where to
 * go, not who to look for (once they carry the cash, the bounty does).
 */
export class FeedReporter {
  constructor(
    private readonly match: MatchApi,
    events: HeistEvents,
  ) {
    events.subscribe((event) => {
      const item = this.itemFor(event);
      if (item) this.match.broadcastJson({ t: 'feed', item });
    });
  }

  private itemFor(event: HeistEvent): FeedItem | undefined {
    switch (event.type) {
      case 'task_solved':
        return undefined; // what someone is working on is their business
      case 'lock_opened': {
        const { spec, lockCount } = event.vault;
        // The last lock is reported as the vault opening instead.
        if (event.lock >= lockCount) return undefined;
        return {
          kind: 'alarm',
          bank: bankName(spec.tier),
          tier: spec.tier,
          lock: event.lock,
          locks: lockCount,
        };
      }
      case 'vault_opened':
        return {
          kind: 'vault_open',
          bank: bankName(event.vault.spec.tier),
          tier: event.vault.spec.tier,
        };
      case 'banked':
        return {
          kind: 'banked',
          id: event.player.id,
          name: event.player.name,
          amount: event.amount,
        };
      case 'wanted':
        return {
          kind: 'wanted',
          id: event.player.id,
          name: event.player.name,
          cash: event.cash,
          reward: event.reward,
        };
      case 'bounty_claimed':
        return {
          kind: 'bounty_claimed',
          killerId: event.killer.id,
          killer: event.killer.name,
          victimId: event.victim.id,
          victim: event.victim.name,
          reward: event.reward,
        };
    }
  }
}
