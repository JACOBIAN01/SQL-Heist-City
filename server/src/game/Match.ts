import {
  Flag,
  PROTOCOL_VERSION,
  encodeServerMessage,
  type EntityState,
  type GameEvent,
  type GameMap,
  type InputCommand,
  type MatchSettings,
  type ServerMessage,
  type SnapshotMessage,
} from '@heist/shared';
import { Player, type PlayerConnection } from './Player';
import { FarthestSpawnPolicy, type SpawnPolicy } from './SpawnPolicy';

export const CLOSE_PROTOCOL = 4000;
export const CLOSE_FULL = 4001;
export const CLOSE_IDLE = 4002;

export type JoinResult =
  | { readonly ok: true; readonly player: Player }
  | { readonly ok: false; readonly code: number; readonly reason: string };

export interface MatchDeps {
  readonly map: GameMap;
  readonly settings: MatchSettings;
  readonly spawnPolicy?: SpawnPolicy;
  /** Wall-clock ms (idle timeouts only; the simulation runs on ticks). */
  readonly now?: () => number;
}

const MAX_ID = 0xffff;

/**
 * One running match: who is in it and what happens each tick. It knows
 * nothing about WebSockets — connections come in as `PlayerConnection`.
 */
export class Match {
  readonly players = new Map<number, Player>();
  tick = 0;
  private nextId = 1;
  private readonly spawnPolicy: SpawnPolicy;
  private readonly now: () => number;

  constructor(private readonly deps: MatchDeps) {
    this.spawnPolicy = deps.spawnPolicy ?? new FarthestSpawnPolicy();
    this.now = deps.now ?? Date.now;
  }

  get map(): GameMap {
    return this.deps.map;
  }

  get settings(): MatchSettings {
    return this.deps.settings;
  }

  join(protocol: number, rawName: string, connection: PlayerConnection): JoinResult {
    if (protocol !== PROTOCOL_VERSION) {
      return { ok: false, code: CLOSE_PROTOCOL, reason: 'Client is out of date, reload the page' };
    }
    if (this.players.size >= this.deps.settings.maxPlayers) {
      return { ok: false, code: CLOSE_FULL, reason: 'Match is full' };
    }
    const id = this.allocateId();
    const spawn = this.spawnPolicy.pick(
      this.deps.map,
      [...this.players.values()].map((p) => p.body),
    );
    const player = new Player(id, cleanName(rawName, id), connection, spawn, this.now());
    this.players.set(id, player);

    this.sendTo(player, {
      t: 'welcome',
      playerId: id,
      tick: this.tick,
      tickRate: this.deps.settings.tickRate,
      mapId: this.deps.map.id,
    });
    // Tell the newcomer who is already here, and everyone else about the newcomer.
    for (const other of this.players.values()) {
      if (other.id === id) continue;
      this.sendTo(player, { t: 'event', event: { e: 'joined', id: other.id, name: other.name } });
    }
    this.broadcast({ e: 'joined', id, name: player.name }, id);
    return { ok: true, player };
  }

  leave(id: number): void {
    if (!this.players.delete(id)) return;
    this.broadcast({ e: 'left', id });
  }

  /** Called with decoded input; applied on the next tick (movement arrives in 5.7). */
  receiveInput(id: number, commands: readonly InputCommand[]): void {
    const player = this.players.get(id);
    if (!player) return;
    player.lastHeardAt = this.now();
    player.enqueue(commands, this.deps.settings.inputQueueLimit);
  }

  /** Marks the client as alive without carrying game data (ping, keep-alives). */
  touch(id: number): void {
    const player = this.players.get(id);
    if (player) player.lastHeardAt = this.now();
  }

  /** One authoritative step: simulate, then send each player their view. */
  step(): void {
    this.tick++;
    this.dropIdlePlayers();
    this.sendSnapshots();
  }

  private dropIdlePlayers(): void {
    const cutoff = this.now() - this.deps.settings.idleTimeoutMs;
    for (const player of [...this.players.values()]) {
      if (player.lastHeardAt < cutoff) {
        player.connection.close(CLOSE_IDLE, 'Timed out');
        this.leave(player.id);
      }
    }
  }

  private sendSnapshots(): void {
    const entities: EntityState[] = [];
    for (const p of this.players.values()) entities.push(entityOf(p));
    for (const player of this.players.values()) {
      const others = entities.filter((e) => e.id !== player.id);
      const b = player.body;
      const snapshot: SnapshotMessage = {
        t: 'snapshot',
        tick: this.tick,
        ackSeq: player.lastAppliedSeq,
        self: {
          x: b.x,
          y: b.y,
          z: b.z,
          vx: b.vx,
          vy: b.vy,
          vz: b.vz,
          flags: flagsOf(player),
          hp: player.hp,
        },
        entities: others,
      };
      this.sendTo(player, snapshot);
    }
  }

  private broadcast(event: GameEvent, exceptId?: number): void {
    const bytes = encodeServerMessage({ t: 'event', event });
    for (const p of this.players.values()) if (p.id !== exceptId) p.connection.send(bytes);
  }

  private sendTo(player: Player, message: ServerMessage): void {
    player.connection.send(encodeServerMessage(message));
  }

  private allocateId(): number {
    for (let i = 0; i < MAX_ID; i++) {
      const id = this.nextId;
      this.nextId = this.nextId >= MAX_ID ? 1 : this.nextId + 1;
      if (!this.players.has(id)) return id;
    }
    throw new Error('no free player ids');
  }
}

export function flagsOf(player: Player): number {
  let flags = 0;
  if (player.body.crouching) flags |= Flag.Crouching;
  if (player.body.onGround) flags |= Flag.OnGround;
  if (player.alive) flags |= Flag.Alive;
  return flags;
}

function entityOf(p: Player): EntityState {
  return {
    id: p.id,
    x: p.body.x,
    y: p.body.y,
    z: p.body.z,
    yaw: p.yaw,
    pitch: p.pitch,
    flags: flagsOf(p),
    hp: p.hp,
  };
}

/** Printable, trimmed, never empty. Names are shown to other players, so no control characters. */
function cleanName(raw: string, id: number): string {
  const cleaned = [...raw]
    .filter((ch) => ch >= ' ' && ch !== '\u007f')
    .join('')
    .trim()
    .slice(0, 20);
  return cleaned.length > 0 ? cleaned : `Player ${id}`;
}
