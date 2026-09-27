/**
 * C5 (character plan): zombie presentation variants, all chosen once from the zombie's ID (stable
 * across saves and chunk streaming) and all visual only: posture and gait never change the move
 * speed, attack range, health or AI (the simulation does not know about them).
 */
export const ZOMBIE_POSTURES = ['shambler', 'hunched', 'lurcher', 'stiff'] as const
export type ZombiePosture = (typeof ZOMBIE_POSTURES)[number]

export interface PostureParams {
  /** Forward lean of the upper body (rad), head pitch/roll (the head tilts to one side). */
  lean: number
  headPitch: number
  headRoll: number
  /** Chest tilted to one side: one shoulder lower (rad). */
  shoulderTilt: number
  /** Stride amplitude and knee bends (scales on the base zombie gait). */
  stride: number
  stanceBend: number
  swingBend: number
  /** One leg drags: +1 left, −1 right, 0 none (shorter swing, stiff knee, toes scraping). */
  drag: number
  /** Pelvis lurch toward the good leg while limping (rad). */
  lurch: number
  /** Arms hanging (not hunting): pitch and elbow bend; arms reaching (hunting): pitch. */
  hang: number
  hangElbow: number
  reach: number
  /** How much of the reach the right arm joins (lurcher: one arm stretched, the other limp). */
  reachRight: number
  /** Sway of the hanging/reaching arms (rad) and head bob speed (Hz-ish). */
  sway: number
  headSpeed: number
}

export const POSTURES: Record<ZombiePosture, PostureParams> = {
  // Drags the left foot, lolled head: the classic slow walker.
  shambler: { lean: 0.14, headPitch: 0.18, headRoll: 0.24, shoulderTilt: 0.04, stride: 0.9, stanceBend: 0.14, swingBend: 0.45, drag: 1, lurch: 0.06, hang: 0.08, hangElbow: -0.2, reach: -1.25, reachRight: 1, sway: 0.1, headSpeed: 1.3 },
  // Bent at the waist, head craned up to look ahead, arms dangling low, short bent-kneed steps.
  hunched: { lean: 0.58, headPitch: -0.42, headRoll: 0.08, shoulderTilt: 0, stride: 0.75, stanceBend: 0.3, swingBend: 0.4, drag: 0, lurch: 0, hang: -0.12, hangElbow: -0.35, reach: -1.4, reachRight: 1, sway: 0.16, headSpeed: 0.9 },
  // One shoulder dropped, the right arm limp, lurching on the right leg.
  lurcher: { lean: 0.12, headPitch: 0.1, headRoll: -0.34, shoulderTilt: -0.2, stride: 1, stanceBend: 0.12, swingBend: 0.5, drag: -1, lurch: 0.09, hang: 0.05, hangElbow: -0.15, reach: -1.35, reachRight: 0.25, sway: 0.12, headSpeed: 1.6 },
  // Upright and rigid: little knee bend, small steps, arms nearly straight.
  stiff: { lean: 0.04, headPitch: 0.05, headRoll: 0.12, shoulderTilt: 0.02, stride: 0.7, stanceBend: 0.05, swingBend: 0.2, drag: 0, lurch: 0.02, hang: 0.02, hangElbow: -0.06, reach: -1.4, reachRight: 1, sway: 0.05, headSpeed: 2.2 },
}

/** Zombie AI states in which the arms reach for the player (hunting); others hang the arms. */
export const REACHING_STATES: ReadonlySet<string> = new Set(['CHASE', 'ATTACK', 'APPROACH_STRUCTURE', 'ATTACK_STRUCTURE'])

export function idHash(id: string, salt = ''): number {
  let h = 2166136261
  const s = salt + id
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  // Avalanche (murmur3 finaliser): IDs differing only in a digit still spread over every bit.
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

export interface ZombieMotion {
  posture: ZombiePosture
  /** Gait phase offset (rad) and stride scale (0.85–1.15): a crowd never steps in unison. */
  phase: number
  stride: number
  /** Idle clock offset (s): sways and head bobs out of step too. */
  time: number
}

export function zombieMotion(id: string): ZombieMotion {
  const h = idHash(id, 'motion')
  return {
    posture: ZOMBIE_POSTURES[h % ZOMBIE_POSTURES.length],
    phase: ((h >>> 4) % 1000) / 1000 * Math.PI * 2,
    stride: 0.85 + ((h >>> 14) % 1000) / 1000 * 0.3,
    time: ((h >>> 22) % 100) / 10,
  }
}
