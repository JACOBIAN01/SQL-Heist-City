import { z } from 'zod';

/**
 * How the game sounds: how far each kind of sound carries, how many play at
 * once, how footsteps are paced. Defaults only, like the other settings. How
 * far a sound carries is a gameplay matter (you hear a fight two streets
 * away, a sneaking player only up close), so it lives here and not in the
 * client.
 */
export const audioSettingsSchema = z.object({
  /** Overall volume, 0–1. */
  volume: z.number().min(0).max(1).default(0.8),
  /** Within this distance (m) a sound plays at full volume; beyond it, it fades. */
  refDistance: z.number().positive().default(3),
  /** How quickly sounds fade with distance (inverse-distance rolloff). */
  rolloff: z.number().positive().default(1.1),
  /** Beyond these distances (m) a sound is not played at all. */
  footstepRange: z.number().positive().default(28),
  shotRange: z.number().positive().default(220),
  engineRange: z.number().positive().default(55),
  crashRange: z.number().positive().default(90),
  alarmRange: z.number().positive().default(160),
  /** Most one-shot sounds playing at once; quieter extras are dropped. */
  maxVoices: z.number().int().positive().default(24),
  /** Most car engines heard at once (the nearest). */
  maxEngines: z.number().int().positive().default(4),
  /** Stride (m) between footsteps: base plus this much per m/s of speed. */
  strideBase: z.number().positive().default(0.55),
  stridePerSpeed: z.number().min(0).default(0.17),
  /** Footstep volume when crouching (sneaking), as a share of walking. */
  crouchStepVolume: z.number().min(0).max(1).default(0.3),
  /** A car losing this much speed (m/s) between two looks crashed into something. */
  crashSpeedDrop: z.number().positive().default(4),
  /** Seconds a vault alarm rings after a lock is cracked. */
  alarmSeconds: z.number().positive().default(18),
  /** Gunshot echo: delay (s), feedback (0–1) and how much of a shot goes into it (0–1). */
  echoDelay: z.number().positive().default(0.21),
  echoFeedback: z.number().min(0).max(0.9).default(0.35),
  echoSend: z.number().min(0).max(1).default(0.35),
  /** Background wind volume, 0–1, and seconds between far-off sirens (min, max). */
  ambienceVolume: z.number().min(0).max(1).default(0.18),
  sirenMinSeconds: z.number().positive().default(45),
  sirenMaxSeconds: z.number().positive().default(120),
});

export type AudioSettings = z.infer<typeof audioSettingsSchema>;
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = audioSettingsSchema.parse({});

/** Metres a body covers between two footsteps at `speed` m/s. */
export const strideAt = (speed: number, s: AudioSettings): number =>
  s.strideBase + s.stridePerSpeed * speed;
