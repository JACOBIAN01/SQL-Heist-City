import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  DEFAULT_STORY_SETTINGS,
  PROTOCOL_VERSION,
  mapById,
  type BarkMessage,
  type GameMap,
  type SceneMessage,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

const city = mapById('city') as GameMap;
const [first, second] = DEFAULT_STORY_SETTINGS.chains;
if (!first || !second) throw new Error('no chains');

function setup() {
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: {
      ...DEFAULT_HEIST_SETTINGS,
      caches: { ...DEFAULT_HEIST_SETTINGS.caches, enabled: false },
      collectibles: { ...DEFAULT_HEIST_SETTINGS.collectibles, enabled: false },
    },
    seed: 'voice-test',
  });
  const connection = new FakeConnection();
  const r = match.join(PROTOCOL_VERSION, 'P', connection);
  if (!r.ok) throw new Error('join failed');
  const scenes = () => connection.jsonOf('scene') as unknown as SceneMessage[];
  const barks = () => connection.jsonOf('bark') as unknown as BarkMessage[];
  const { events } = match.heist;
  const seconds = (n: number) => {
    for (let i = 0; i < n * match.tickRate; i++) match.step();
  };
  return { match, player: r.player, heist: match.heist, scenes, barks, events, seconds };
}

describe('the story’s voice (32.3)', () => {
  it('opens the first chain with its scene when the student joins', () => {
    const { scenes } = setup();
    expect(scenes()).toHaveLength(1);
    expect(scenes()[0]?.id).toBe(first.intro);
    expect(scenes()[0]?.lines.length).toBeGreaterThan(1);
  });

  it('plays a scene only once, even if asked again', () => {
    const { heist, player, scenes } = setup();
    heist.voice.scene(player, first.intro);
    heist.voice.introFor(player);
    expect(scenes()).toHaveLength(1);
  });

  it('closes a chain with its scene and opens the next with its own', () => {
    const { heist, player, scenes, events } = setup();
    events.publish({ type: 'intel_gained', player, bank: 'bank-1', level: 1 });
    events.publish({ type: 'job_done', player, kind: 'delivery' });
    events.publish({ type: 'heist_complete', player, bank: 'bank-1', tier: 1, mastery: 0 });
    expect(heist.story.stepsOf(player, 'bank-1')).toBe(3);
    expect(scenes().map((s) => s.id)).toEqual([first.intro, first.outro, second.intro]);
  });

  it('has the fixer say a line at a moment, in their own voice', () => {
    const { player, barks, events } = setup();
    events.publish({ type: 'intel_gained', player, bank: 'bank-1', level: 1 });
    expect(barks()).toHaveLength(1);
    expect(barks()[0]?.speaker).toBe('Mae');
    expect(barks()[0]?.text).toBe('Read it slowly. The answer is in the table.');
  });

  it('falls back to a line anyone can say, in the fixer’s name', () => {
    const { player, barks, events } = setup();
    events.publish({ type: 'bag_taken', player, amount: 10, x: 0, z: 0 });
    expect(barks()[0]).toMatchObject({
      speaker: 'Mae',
      text: DEFAULT_STORY_SETTINGS.barks['any']?.['getaway']?.[0],
    });
  });

  it('does not chatter: lines to one student are spaced out', () => {
    const { player, barks, events, seconds } = setup();
    events.publish({ type: 'job_done', player, kind: 'race' });
    events.publish({ type: 'job_done', player, kind: 'race' });
    expect(barks()).toHaveLength(1);
    seconds(9);
    events.publish({ type: 'job_done', player, kind: 'race' });
    expect(barks()).toHaveLength(2);
  });

  it('says only one getaway line for a getaway, however many bags are taken', () => {
    const { player, barks, events, seconds } = setup();
    events.publish({ type: 'bag_taken', player, amount: 10, x: 0, z: 0 });
    seconds(9);
    events.publish({ type: 'bag_taken', player, amount: 10, x: 0, z: 0 });
    expect(barks()).toHaveLength(1);
  });

  it('speaks for the wanted level and a lost getaway', () => {
    const { player, barks, events, seconds } = setup();
    events.publish({ type: 'stars', player, stars: 2 });
    seconds(9);
    events.publish({ type: 'heist_failed', player, bank: 'bank-1' });
    expect(barks().map((b) => b.text)).toEqual([
      DEFAULT_STORY_SETTINGS.barks['any']?.['wanted']?.[0],
      DEFAULT_STORY_SETTINGS.barks['any']?.['failed']?.[0],
    ]);
  });

  it('says nothing when the story is switched off', () => {
    const { heist, player, scenes, barks, events } = setup();
    heist.story.bindSettings(() => ({ ...DEFAULT_STORY_SETTINGS, enabled: false }));
    events.publish({ type: 'intel_gained', player, bank: 'bank-1', level: 1 });
    expect(barks()).toHaveLength(0);
    expect(scenes().length).toBeLessThanOrEqual(1);
  });
});
