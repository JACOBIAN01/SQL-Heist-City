import type { FeedItem } from '@heist/shared';
import { formatMoney, type FeedTone } from '../ui/hud/Hud';

/** How a feed item reads on screen, from this player's point of view. */
export function feedText(item: FeedItem, myId: number): { text: string; tone: FeedTone } {
  switch (item.kind) {
    case 'alarm':
      return {
        text: `ALARM · ${item.bank} (bank ${item.tier}): lock ${item.lock}/${item.locks} cracked`,
        tone: 'alarm',
      };
    case 'vault_open':
      return { text: `${item.bank} vault is OPEN — the cash is out`, tone: 'vault' };
    case 'banked':
      return {
        text: `${item.id === myId ? 'You' : item.name} banked ${formatMoney(item.amount)}`,
        tone: 'good',
      };
    case 'wanted':
      return {
        text:
          item.id === myId
            ? `You are WANTED: everyone sees you on the map (${formatMoney(item.reward)} bounty)`
            : `${item.name} carries ${formatMoney(item.cash)} · ${formatMoney(item.reward)} bounty`,
        tone: 'bounty',
      };
    case 'bounty_claimed':
      return {
        text: `${item.killerId === myId ? 'You' : item.killer} claimed the ${formatMoney(item.reward)} bounty on ${item.victimId === myId ? 'you' : item.victim}`,
        tone: 'bounty',
      };
  }
}
