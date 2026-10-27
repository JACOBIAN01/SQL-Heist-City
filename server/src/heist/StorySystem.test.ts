import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  DEFAULT_STORY_SETTINGS,
  PROTOCOL_VERSION,
  mapById,
  storySettingsSchema,
  type GameMap,
  type StoryMessage,
  type StorySettings,
} from '@heist/shared';
import { Match } from '../game/Match';
import type { Player } from '../game/Player';
import { FakeConnection } from '../game/testing';
import { InMemoryStoryStore } from '../progress/StoryStore';

const city = mapById('city') as GameMap;
const settle = () => new Promise((r) => setTimeout(r, 0));
const [first, second] = DEFAULT_STORY_SETTINGS.chains;
if (!first || !second) throw new Error('the default story has no chains');

async function setup(accountId?: number, store = new InMemoryStoryStore()) {
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: {
      ...DEFAULT_HEIST_SETTINGS,
      caches: { ...DEFAULT_HEIST_SETTINGS.caches, enabled: false },
      collectibles: { ...DEFAULT_HEIST_SETTINGS.collectibles, enabled: false },
    },
    seed: 'story-test',
  });
  match.heist.story.bindStore(store);
  const connection = new FakeConnection();
  const r = match.join(PROTOCOL_VERSION, 'P', connection, accountId);
  if (!r.ok) throw new Error('join failed');
  await settle();
  const last = () => connection.jsonOf('story').at(-1) as unknown as StoryMessage | undefined;
  const { events, story } = match.heist;
  const intel = (p: Player, bank: string, level: number) =>
    events.publish({ type: 'intel_gained', player: p, bank, level });
  const job = (p: Player, kind: string) => events.publish({ type: 'job_done', player: p, kind });
  const heist = (p: Player, bank: string) =>
    events.publish({ type: 'heist_complete', player: p, bank, tier: 1, mastery: 0 });
  return { match, player: r.player, story, store, last, intel, job, heist, events };
}

describe('the story chains (32.2)', () => {
  it('tell a new student the first chain is theirs and the rest are locked', async () => {
    const { last } = await setup();
    const states = last()?.chains.map((c) => c.state);
    expect(states).toEqual(['active', 'locked', 'locked', 'locked', 'locked']);
    expect(last()?.chains[0]?.current?.title).toBe(first.steps[0]?.title);
    expect(last()?.pages).toBe(0);
  });

  it('move through a chain by doing what each step asks, in order', async () => {
    const { player, story, last, intel, job, heist } = await setup();
    intel(player, 'bank-1', 1);
    expect(story.stepsOf(player, 'bank-1')).toBe(1);
    expect(last()?.chains[0]?.current?.title).toBe(first.steps[1]?.title);
    job(player, 'delivery');
    expect(story.stepsOf(player, 'bank-1')).toBe(2);
    heist(player, 'bank-1');
    expect(story.stepsOf(player, 'bank-1')).toBe(3);
  });

  it('ignore the wrong thing: another bank, too little intel, the wrong kind of contract', async () => {
    const { player, story, intel, job, heist } = await setup();
    intel(player, 'bank-2', 3); // a chain that is not open yet
    expect(story.stepsOf(player, 'bank-2')).toBe(0);
    expect(story.stepsOf(player, 'bank-1')).toBe(0);
    job(player, 'delivery'); // the briefing comes first
    heist(player, 'bank-1');
    expect(story.stepsOf(player, 'bank-1')).toBe(0);
    intel(player, 'bank-1', 1);
    job(player, 'escort'); // this favour is a delivery
    expect(story.stepsOf(player, 'bank-1')).toBe(1);
  });

  it('pay the reward, give the page and open the next chain when one is finished', async () => {
    const { player, story, last, events, intel, job, heist } = await setup();
    const done: { bank: string; xp: number }[] = [];
    events.subscribe((e) => {
      if (e.type === 'chain_complete') done.push({ bank: e.bank, xp: e.xp });
    });
    intel(player, 'bank-1', 1);
    job(player, 'delivery');
    heist(player, 'bank-1');
    expect(player.cash).toBe(first.reward.cash);
    expect(done).toEqual([{ bank: 'bank-1', xp: first.reward.xp }]);
    expect(last()?.finished).toBe('bank-1');
    expect(last()?.pages).toBe(1);
    expect(last()?.chains.map((c) => c.state)).toEqual([
      'done',
      'active',
      'locked',
      'locked',
      'locked',
    ]);
    expect(last()?.chains[0]?.page).toBe(first.page);
    // The second chain now counts.
    intel(player, 'bank-2', 1);
    expect(story.stepsOf(player, 'bank-2')).toBe(1);
  });

  it('ask for more intel on the higher banks', async () => {
    const settings: StorySettings = storySettingsSchema.parse({
      chains: [
        {
          ...first,
          steps: [{ ...first.steps[0], need: { type: 'intel', level: 2 } }, first.steps[2]],
        },
      ],
    });
    const { player, story, intel } = await setup();
    story.bindSettings(() => settings);
    intel(player, 'bank-1', 1);
    expect(story.stepsOf(player, 'bank-1')).toBe(0);
    intel(player, 'bank-1', 2);
    expect(story.stepsOf(player, 'bank-1')).toBe(1);
  });

  it('keep a signed-in student’s place across matches, but not a guest’s', async () => {
    const store = new InMemoryStoryStore();
    const one = await setup(4, store);
    one.intel(one.player, 'bank-1', 1);
    await settle();
    expect(await store.steps(4)).toEqual({ 'bank-1': 1 });
    const two = await setup(4, store);
    expect(two.story.stepsOf(two.player, 'bank-1')).toBe(1);
    const guest = await setup(undefined, store);
    expect(guest.story.stepsOf(guest.player, 'bank-1')).toBe(0);
    guest.intel(guest.player, 'bank-1', 1);
    await settle();
    expect(await store.steps(4)).toEqual({ 'bank-1': 1 }); // nothing saved for a guest
  });

  it('share a finished heist with squad-mates close by', async () => {
    const { match, player, story, intel, job, heist } = await setup();
    const mate = match.join(PROTOCOL_VERSION, 'M', new FakeConnection());
    if (!mate.ok) throw new Error('join failed');
    await settle();
    for (const p of [player, mate.player]) {
      intel(p, 'bank-1', 1);
      job(p, 'delivery');
      p.squad = 1;
    }
    match.teleport(mate.player, player.body.x + 10, 0, player.body.z);
    heist(player, 'bank-1');
    expect(story.stepsOf(mate.player, 'bank-1')).toBe(3);
  });

  it('do nothing when the story is switched off', async () => {
    const { player, story, intel } = await setup();
    story.bindSettings(() => ({ ...DEFAULT_STORY_SETTINGS, enabled: false }));
    intel(player, 'bank-1', 1);
    expect(story.stepsOf(player, 'bank-1')).toBe(0);
  });
});
