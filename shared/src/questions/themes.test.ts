import { describe, expect, it } from 'vitest';
import { themeSchema, themeSql, themeStory, themeText } from './themes';

const casino = themeSchema.parse({
  name: 'casino',
  tables: { accounts: 'players', transactions: 'bets' },
  columns: { balance: 'chips', account_id: 'player_id' },
  words: { account: 'player', accounts: 'players', bank: 'casino' },
});

describe('themes', () => {
  it('renames tables and columns in SQL, whole words only, never inside string literals', () => {
    expect(
      themeSql(
        "SELECT a.balance, t.account_id FROM accounts a JOIN transactions t ON t.account_id = a.id WHERE a.owner = 'accounts' AND x.balance_old = 1",
        casino,
      ),
    ).toBe(
      "SELECT a.chips, t.player_id FROM players a JOIN bets t ON t.player_id = a.id WHERE a.owner = 'accounts' AND x.balance_old = 1",
    );
    expect(themeSql('CREATE INDEX accounts_owner ON accounts(owner);', casino)).toBe(
      'CREATE INDEX accounts_owner ON players(owner);',
    );
    expect(themeSql('SELECT 1', null)).toBe('SELECT 1');
  });

  it('swaps words in prose keeping capitals, and names in code spans and bold', () => {
    expect(themeText('Every account at the Bank: `accounts.balance`', casino)).toBe(
      'Every player at the Casino: `players.chips`',
    );
    expect(themeStory('Return **balance** for each account.', casino)).toBe(
      'Return **chips** for each player.',
    );
  });
});
