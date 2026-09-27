import { GAIT_SMOOTHING, smoothSpeed } from './gait'

/**
 * C3 (character plan): player locomotion as seen, from the body's real motion. The simulation keeps
 * its intended speed and stride phase (footstep sounds, hearing radius: gameplay); the legs follow
 * what the body actually does after collisions:
 * - blocked by a wall → the legs slow down and stop instead of running in place; sliding along a
 *   wall → the tangential speed;
 * - moving normally → the phase locks onto the simulation's stride phase, so every foot plant still
 *   matches its footstep sound;
 * - moving against the facing (the facing stays on the cursor while swinging) → the gait runs
 *   backwards, and the pelvis turns toward the path (up to ±40°) while the chest keeps the facing.
 * Pure and frame-rate independent (same filters as `gait.ts`); `delta = 0` (paused) changes nothing.
 */
export interface PlayerGait {
  /** Visual gait phase (rad). */
  phase: number
  /** Visual speed (m/s): the filtered speed of the body, never above the intended speed. */
  speed: number
  /** Filtered velocity of the body (m/s, world XZ). */
  vx: number
  vz: number
  /** Pelvis turn toward the direction of travel, relative to the facing (rad). */
  hipTurn: number
  /** +1 walking forward, −1 walking backward (eased). */
  direction: number
  last: { x: number; z: number } | null
}

export function createPlayerGait(): PlayerGait {
  return { phase: 0, speed: 0, vx: 0, vz: 0, hipTurn: 0, direction: 1, last: null }
}

/** Largest pelvis turn toward the path; beyond it the legs walk slightly crabwise. */
export const MAX_HIP_TURN = 0.7
/** Phase lock toward the simulation's stride (1/s). */
const PHASE_LOCK = 6
/** Pelvis turn / direction easing (s). */
const TURN_TAU = 0.12

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const ease = (current: number, target: number, delta: number, tau: number) => current + (target - current) * (1 - Math.exp(-delta / tau))

export interface PlayerGaitInput {
  /** Body position this frame (feet, world). */
  x: number
  z: number
  facing: number
  /** Simulation: intended speed and stride phase (advanced every tick, drives the footsteps). */
  intendedSpeed: number
  stridePhase: number
  /** Metres per gait cycle at the current pace (walk or run stride). */
  stride: number
  alive: boolean
}

export function advancePlayerGait(g: PlayerGait, input: PlayerGaitInput, delta: number): void {
  if (delta <= 0) return
  const dx = g.last ? input.x - g.last.x : 0
  const dz = g.last ? input.z - g.last.z : 0
  g.last = { x: input.x, z: input.z }
  // Teleports (load, debug) are not motion.
  const jump = Math.hypot(dx, dz) > 1
  const k = 1 - Math.exp(-delta / GAIT_SMOOTHING)
  g.vx += ((jump ? 0 : dx / delta) - g.vx) * k
  g.vz += ((jump ? 0 : dz / delta) - g.vz) * k
  const measured = Math.hypot(g.vx, g.vz)
  const target = input.alive ? Math.min(measured, input.intendedSpeed) : 0
  g.speed = smoothSpeed(g.speed, target, delta)

  // Travel direction relative to the facing: forward half → pelvis turns toward it; backward half →
  // the gait reverses and the pelvis turns toward the opposite of the path.
  if (g.speed > 0.2) {
    const rel = wrap(Math.atan2(g.vx, g.vz) - input.facing)
    const backward = Math.abs(rel) > Math.PI / 2 + 0.2
    g.direction = ease(g.direction, backward ? -1 : 1, delta, TURN_TAU)
    const turn = backward ? wrap(rel - Math.PI) : rel
    g.hipTurn = ease(g.hipTurn, Math.max(-MAX_HIP_TURN, Math.min(MAX_HIP_TURN, turn)), delta, TURN_TAU)
  } else {
    g.hipTurn = ease(g.hipTurn, 0, delta, TURN_TAU)
    g.direction = ease(g.direction, 1, delta, TURN_TAU)
  }

  // Phase: distance actually covered; while the body moves as intended it is pulled onto the
  // simulation's stride phase (forward walking only), so plants and footstep sounds coincide.
  const ratio = input.intendedSpeed > 0 ? Math.min(1, g.speed / input.intendedSpeed) : 0
  const step = (g.speed * delta / Math.max(0.1, input.stride)) * Math.PI * 2 * Math.sign(g.direction || 1)
  let phase = g.phase + step
  if (g.direction > 0.5 && ratio > 0.8) phase += wrap(input.stridePhase - phase) * Math.min(1, PHASE_LOCK * delta) * ratio
  g.phase = ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
}
