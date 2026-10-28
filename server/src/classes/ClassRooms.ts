import {
  DEFAULT_MODES_SETTINGS,
  consentIsCurrent,
  customMode,
  modeById,
  parseCustomModeId,
  type ModesSettings,
} from '@heist/shared';
import type { HeistSettings, MatchSettings } from '@heist/shared';
import { cityMapIdFor, citySettingsSchema, type CitySettings } from '@heist/shared';
import type { MapName } from '../game/maps';
import type { ClassCommand, MatchExtras, MatchInfo } from '../game/MatchPool';
import { classMatchConfig } from './ClassMatchConfig';
import type { CustomHeistRepository } from './CustomHeistRepository';
import type { ClassRepository } from './ClassRepository';

/** The part of the match pool a class room needs (so tests can pass a fake). */
export interface RoomPool {
  start(
    settings: MatchSettings,
    port: number,
    map: MapName,
    extras: MatchExtras,
  ): Promise<MatchInfo>;
  classRoom(classId: number): MatchInfo | undefined;
  commandClass(classId: number, command: ClassCommand): boolean;
  stopClass(classId: number): Promise<boolean>;
}

export interface RoomStatus {
  readonly state: 'waiting' | 'live';
  readonly port?: number;
  /** The city the room plays, so a client builds the same one before connecting. */
  readonly mapId?: string;
  readonly players?: number;
  readonly maxPlayers?: number;
}

export interface RoomDeps {
  readonly classes: ClassRepository;
  readonly pool: RoomPool;
  readonly matchSettings: MatchSettings;
  /** What every room's match is built from (database snapshot, tickets). */
  readonly extras: () => Omit<MatchExtras, 'classConfig'>;
  readonly city: () => CitySettings;
  readonly heist: () => HeistSettings;
  /** The game modes a class can pick (Phase 28); without it every class plays classic. */
  readonly modes?: () => ModesSettings;
  /** Teachers' own heists, played by picking `custom-<id>` as a class's mode (Phase 34.5). */
  readonly customHeists?: CustomHeistRepository;
}

export type RoomAction =
  | { readonly action: 'start' }
  | { readonly action: 'stop' }
  | { readonly action: 'refresh' }
  | { readonly action: 'end_round' }
  | { readonly action: 'next_round' }
  | { readonly action: 'kick'; readonly accountId: number }
  | { readonly action: 'rename'; readonly accountId: number; readonly name: string };

export type RoomResult =
  | { readonly ok: true; readonly status: RoomStatus }
  | {
      readonly ok: false;
      readonly reason: 'unknown_class' | 'not_live' | 'archived' | 'consent_required';
    };

/**
 * One match per class (docs/gameplay.md, classroom mode). The teacher starts
 * a room; students who joined the class connect to it; each room is its own
 * thread, so classes never see each other's players or questions.
 *
 * Pattern: Facade — Why: the admin's live controls and the lobby ask one
 * object for "start", "status" and "kick"; the pool, the question set and the
 * city are put together here.
 */
export class ClassRooms {
  /** Rooms being started, so two quick "start" clicks make one room. */
  private readonly starting = new Map<number, Promise<MatchInfo>>();
  private readonly maps = new Map<number, string>();

  constructor(private readonly deps: RoomDeps) {}

  status(classId: number): RoomStatus {
    const room = this.deps.pool.classRoom(classId);
    return room
      ? {
          state: 'live',
          port: room.port,
          players: room.players,
          maxPlayers: room.maxPlayers,
          ...(this.maps.has(classId) ? { mapId: this.maps.get(classId) as string } : {}),
        }
      : { state: 'waiting' };
  }

  async handle(classId: number, command: RoomAction): Promise<RoomResult> {
    const record = await this.deps.classes.get(classId);
    if (!record) return { ok: false, reason: 'unknown_class' };
    switch (command.action) {
      case 'start':
        if (record.archived) return { ok: false, reason: 'archived' };
        // The school has to have accepted the current terms first (Phase 21.3).
        if (!consentIsCurrent(record.consent)) return { ok: false, reason: 'consent_required' };
        await this.start(classId);
        return { ok: true, status: this.status(classId) };
      case 'stop':
        await this.deps.pool.stopClass(classId);
        return { ok: true, status: this.status(classId) };
      case 'refresh':
        return this.send(classId, async () => ({
          type: 'class_config',
          config: await this.config(classId),
        }));
      case 'end_round':
        return this.send(classId, async () => ({ type: 'end_round' }));
      case 'next_round':
        return this.send(classId, async () => ({ type: 'next_round' }));
      case 'kick':
        return this.send(classId, async () => ({ type: 'kick', accountId: command.accountId }));
      case 'rename':
        return this.send(classId, async () => ({
          type: 'rename',
          accountId: command.accountId,
          name: command.name,
        }));
    }
  }

  private async send(classId: number, make: () => Promise<ClassCommand>): Promise<RoomResult> {
    if (!this.deps.pool.classRoom(classId)) return { ok: false, reason: 'not_live' };
    this.deps.pool.commandClass(classId, await make());
    return { ok: true, status: this.status(classId) };
  }

  private async config(classId: number) {
    const record = await this.deps.classes.get(classId);
    if (!record) throw new Error(`class ${classId} is gone`);
    const customId = parseCustomModeId(record.mode);
    const custom = customId === undefined ? undefined : await this.deps.customHeists?.get(customId);
    return classMatchConfig(
      record,
      await this.deps.classes.questions(classId),
      await this.deps.classes.squads(classId),
      // A custom heist plays as its own mode; one that has been deleted falls back to classic.
      custom
        ? customMode(custom.id, custom.spec)
        : modeById(this.deps.modes?.() ?? DEFAULT_MODES_SETTINGS, record.mode),
    );
  }

  private async start(classId: number): Promise<MatchInfo> {
    const running = this.deps.pool.classRoom(classId);
    if (running) return running;
    const pending = this.starting.get(classId);
    if (pending) return pending;
    const launch = (async () => {
      const config = await this.config(classId);
      const city = citySettingsSchema.parse({
        ...this.deps.city(),
        ...(config.citySeed ? { seed: config.citySeed } : {}),
      });
      const mapId = cityMapIdFor(city);
      this.maps.set(classId, mapId);
      return this.deps.pool.start(
        { ...this.deps.matchSettings, maxPlayers: config.playerCap, sandboxDummies: 0 },
        0,
        mapId as MapName,
        { ...this.deps.extras(), heist: this.deps.heist(), classConfig: config },
      );
    })();
    this.starting.set(classId, launch);
    try {
      return await launch;
    } finally {
      this.starting.delete(classId);
    }
  }
}
