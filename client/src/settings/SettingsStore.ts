import { DEFAULT_PLAYER_SETTINGS, readPlayerSettings, type PlayerSettings } from '@heist/shared';

const KEY = 'heist.settings.v1';

/** Where a signed-in player's settings live besides this browser. */
export interface SettingsSync {
  /** The account's settings and when they last changed; none when there are none (or not signed in). */
  load(): Promise<{ settings: PlayerSettings; updatedAt: string } | undefined>;
  save(settings: PlayerSettings): Promise<void>;
}

interface Saved {
  readonly settings: unknown;
  readonly updatedAt: string;
}

type Listener = (settings: PlayerSettings) => void;

/**
 * The player's settings (Phase 22.1): applied at once, kept in this browser at once, and, for a
 * signed-in player, sent to their account a moment after the last change. On a new device the
 * account's copy is taken when it is newer. A browser that blocks storage still works for the visit.
 *
 * Pattern: Observer — Why: the input, audio, camera and HUD each react to a change; none of them
 * knows about the settings panel, and the panel knows about none of them.
 */
export class SettingsStore {
  private value: PlayerSettings;
  private updatedAt = '';
  private readonly listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeStorage(),
    private readonly sync?: SettingsSync,
    private readonly debounceMs = 800,
    private readonly now: () => Date = () => new Date(),
  ) {
    const saved = this.read();
    this.value = saved ? readPlayerSettings(saved.settings) : DEFAULT_PLAYER_SETTINGS;
    this.updatedAt = saved?.updatedAt ?? '';
  }

  get current(): PlayerSettings {
    return this.value;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Replaces the settings (the panel builds the new whole from the old). */
  set(next: PlayerSettings): void {
    this.value = readPlayerSettings(next);
    this.updatedAt = this.now().toISOString();
    this.write();
    this.emit();
    this.scheduleSave();
  }

  /** Back to the defaults. */
  reset(): void {
    this.set(DEFAULT_PLAYER_SETTINGS);
  }

  /**
   * Looks at the account's copy and takes it if it is newer than this browser's. Call once the
   * player is known to be signed in.
   */
  async fromAccount(): Promise<void> {
    if (!this.sync) return;
    let remote;
    try {
      remote = await this.sync.load();
    } catch {
      return;
    }
    if (!remote) {
      // The account has none yet: give it this browser's, if the player ever changed anything.
      if (this.updatedAt) this.scheduleSave();
      return;
    }
    if (remote.updatedAt > this.updatedAt) {
      this.value = readPlayerSettings(remote.settings);
      this.updatedAt = remote.updatedAt;
      this.write();
      this.emit();
    } else if (remote.updatedAt < this.updatedAt) this.scheduleSave();
  }

  /** Sends any change that is waiting, now (the page is closing). */
  async flush(): Promise<void> {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.push();
  }

  private scheduleSave(): void {
    if (!this.sync) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.push();
    }, this.debounceMs);
  }

  private async push(): Promise<void> {
    try {
      await this.sync?.save(this.value);
    } catch {
      // Offline or signed out: the browser's copy is kept and goes up with the next change.
    }
  }

  private emit(): void {
    for (const l of this.listeners) l(this.value);
  }

  private read(): Saved | undefined {
    try {
      const text = this.storage?.getItem(KEY);
      return text ? (JSON.parse(text) as Saved) : undefined;
    } catch {
      return undefined;
    }
  }

  private write(): void {
    try {
      this.storage?.setItem(
        KEY,
        JSON.stringify({ settings: this.value, updatedAt: this.updatedAt }),
      );
    } catch {
      // Storage blocked: the settings last for this visit only.
    }
  }
}

function safeStorage(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}
