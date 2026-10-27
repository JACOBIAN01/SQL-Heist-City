import type {
  BarkEvent,
  BarkMessage,
  Rng,
  SceneMessage,
  StoryChain,
  StorySettings,
} from '@heist/shared';
import type { Player } from '../game/Player';
import type { HeistEvents } from './HeistEvents';
import type { MatchApi } from './MatchApi';

/** The least time (s) between two barks to one player, so a busy heist is not a chatter. */
const BARK_GAP_SECONDS = 8;
/** A bark that begins "Name: " is said by that name. */
const SPEAKER_PREFIX = /^([A-Z][A-Za-z]+): /;

/** What the voice needs to know about the story. */
export interface StoryTalk {
  settings(): StorySettings;
  /** The chain this student is on now, if any. */
  chainOf(player: Player): StoryChain | undefined;
  /** Steps finished in a bank's chain. */
  stepsOf(player: Player, bank: string): number;
}

/**
 * The voices of the story (Phase 32.3): scenes at the start and end of each chain, and short lines
 * from the fixer at moments in a heist. Scenes are played once a match and can be skipped; barks are
 * spaced out. It only listens: the rules it comments on know nothing of it.
 * Pattern: Observer — Why: what is said is data (the story settings), chosen by what already happened.
 */
export class StoryVoice {
  private readonly shown = new Set<string>();
  private readonly lastBark = new Map<Player, number>();
  /** Players on a getaway who have been told so already (one bark each). */
  private readonly onGetaway = new Set<Player>();

  constructor(
    private readonly match: MatchApi,
    events: HeistEvents,
    private readonly story: StoryTalk,
    private readonly rng: Rng,
    private readonly active: () => boolean,
  ) {
    events.subscribe((e) => {
      if (!this.story.settings().enabled || !this.active()) return;
      switch (e.type) {
        case 'intel_gained':
          return this.bark(e.player, 'intel');
        case 'lock_opened':
          return e.player ? this.bark(e.player, 'lock') : undefined;
        case 'vault_opened':
          return e.by ? this.bark(e.by, 'vault') : undefined;
        case 'bag_taken':
          if (this.onGetaway.has(e.player)) return;
          this.onGetaway.add(e.player);
          return this.bark(e.player, 'getaway');
        case 'heist_complete':
          this.onGetaway.delete(e.player);
          return this.bark(e.player, 'complete');
        case 'heist_failed':
          this.onGetaway.delete(e.player);
          return this.bark(e.player, 'failed');
        case 'job_done':
          return this.bark(e.player, 'job');
        case 'stars':
          return e.stars > 0 ? this.bark(e.player, 'wanted') : undefined;
        default:
          return;
      }
    });
  }

  forget(player: Player): void {
    this.lastBark.delete(player);
    this.onGetaway.delete(player);
    for (const key of [...this.shown]) if (key.startsWith(`${player.id}:`)) this.shown.delete(key);
  }

  /** A scene, once per student and match (a second ask does nothing). */
  scene(player: Player, id: string): void {
    const key = `${player.id}:${id}`;
    const scene = this.story.settings().scenes[id];
    if (!scene || this.shown.has(key)) return;
    this.shown.add(key);
    const message: SceneMessage = { t: 'scene', id, title: scene.title, lines: scene.lines };
    this.match.sendJson(player, message);
  }

  /** The scene that opens the chain the student is on, if they have not begun it. */
  introFor(player: Player): void {
    const chain = this.story.chainOf(player);
    if (chain && this.story.stepsOf(player, chain.bank) === 0) this.scene(player, chain.intro);
  }

  /** A chain was finished: its closing scene, then the opening of the next. */
  chainDone(player: Player, chain: StoryChain): void {
    this.scene(player, chain.outro);
    this.introFor(player);
  }

  /** Says one line for a moment, in the voice of the fixer the student is working for. */
  bark(player: Player, moment: BarkEvent): void {
    const now = this.match.tick / this.match.tickRate;
    const last = this.lastBark.get(player);
    if (last !== undefined && now - last < BARK_GAP_SECONDS) return;
    const chain = this.story.chainOf(player);
    const barks = this.story.settings().barks;
    const lines = (chain && barks[chain.bank]?.[moment]) ?? barks['any']?.[moment];
    if (!lines || lines.length === 0) return;
    const raw = this.rng.pick(lines);
    const named = SPEAKER_PREFIX.exec(raw);
    const message: BarkMessage = {
      t: 'bark',
      speaker: named?.[1] ?? chain?.fixer.name.split(' ')[0] ?? 'Crew',
      text: named ? raw.slice(named[0].length) : raw,
    };
    this.lastBark.set(player, now);
    this.match.sendJson(player, message);
  }
}
