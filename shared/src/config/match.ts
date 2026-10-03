import { z } from 'zod';

/** Match-level numbers. Defaults only; the admin settings table can override them (docs/gameplay.md). */
export const matchSettingsSchema = z.object({
  /** Authoritative simulation/snapshot rate (Hz). */
  tickRate: z.number().int().min(5).max(60).default(20),
  /** 60 / 100 / 200 are the supported sizes (docs/backend.md). */
  maxPlayers: z.number().int().min(1).max(500).default(100),
  /**
   * Input commands applied per player per tick. At 60 Hz input and 20 Hz ticks
   * a normal client sends 3; the slack absorbs jitter but stops a client from
   * fast-forwarding its own clock (speed hacking).
   */
  maxCommandsPerTick: z.number().int().min(1).max(30).default(6),
  /** Commands waiting to be applied; more than this and the oldest are dropped. */
  inputQueueLimit: z.number().int().min(1).max(200).default(30),
  /**
   * Stationary target dummies in the Phase 5 sandbox, so shooting can be tried
   * with one browser tab. They count as players, never move and always respawn
   * where they stand. Set 0 to disable (Phase 7 removes them).
   */
  sandboxDummies: z.number().int().min(0).max(20).default(2),
  /** Disconnect a client that sends nothing for this long (ms). */
  idleTimeoutMs: z.number().int().min(1000).default(15_000),
});

export type MatchSettings = z.infer<typeof matchSettingsSchema>;
export const DEFAULT_MATCH_SETTINGS: MatchSettings = matchSettingsSchema.parse({});
