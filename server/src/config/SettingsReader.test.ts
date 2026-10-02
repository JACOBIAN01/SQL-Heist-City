import { describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_SETTINGS } from '@heist/shared';
import { openDatabase } from '../db/database';
import { CHALLENGE_SETTINGS_KEY, SqliteSettingsReader } from './SettingsReader';

function setup() {
  const db = openDatabase({ path: ':memory:' });
  return { db, reader: new SqliteSettingsReader(db) };
}

describe('SqliteSettingsReader', () => {
  it('returns defaults on an empty database', () => {
    const { reader } = setup();
    expect(reader.challengeSettings()).toEqual(DEFAULT_CHALLENGE_SETTINGS);
    expect(reader.rewardTiers('gun:rifle')).toEqual({ min: 4, max: 4 });
    expect(reader.rewardTiers('gun:laser')).toBeUndefined();
  });

  it('applies admin overrides on top of defaults', () => {
    const { db, reader } = setup();
    db.prepare('INSERT INTO settings VALUES (?, ?)').run(
      CHALLENGE_SETTINGS_KEY,
      '{"lockoutSec": 5}',
    );
    db.prepare("INSERT INTO reward_map VALUES ('gun:rifle', 2, 3)").run();
    expect(reader.challengeSettings()).toEqual({ ...DEFAULT_CHALLENGE_SETTINGS, lockoutSec: 5 });
    expect(reader.rewardTiers('gun:rifle')).toEqual({ min: 2, max: 3 });
  });

  it('falls back to defaults when stored settings are invalid', () => {
    const { db, reader } = setup();
    db.prepare('INSERT INTO settings VALUES (?, ?)').run(
      CHALLENGE_SETTINGS_KEY,
      '{"lockoutSec": -1',
    );
    expect(reader.challengeSettings()).toEqual(DEFAULT_CHALLENGE_SETTINGS);
  });
});
