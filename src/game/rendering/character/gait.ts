/**
 * Frame-rate independent gait helpers. Physics steps at a fixed 1/60 s while frames can run at
 * 144 Hz+, so a body moves only on some frames: speed measured per frame flips between 0 and
 * ~2.4× the real speed. Speeds are low-pass filtered with a time constant (same result at any
 * frame rate) and the gait phase is integrated from the filtered speed, so legs move smoothly.
 */
export const GAIT_SMOOTHING = 0.12
/** Below this the character counts as standing (legs settle to neutral). */
const REST_SPEED = 0.05

/** Exponential approach of `current` to `target` with time constant `tau` seconds. */
export function smoothSpeed(current: number, target: number, delta: number, tau = GAIT_SMOOTHING): number {
  if (delta <= 0) return current
  const next = current + (target - current) * (1 - Math.exp(-delta / tau))
  return next < REST_SPEED && target < REST_SPEED ? 0 : next
}

/** Gait of a body we only observe through its position (zombies). */
export interface MeasuredGait {
  phase: number
  speed: number
  last: { x: number; z: number } | null
}

export function createMeasuredGait(): MeasuredGait {
  return { phase: 0, speed: 0, last: null }
}

/**
 * Advance from the observed position. `stride` = metres per full cycle (two steps). Jumps over
 * 1 m in one frame (load/debug teleports) are ignored.
 */
export function advanceMeasuredGait(g: MeasuredGait, x: number, z: number, delta: number, stride: number, moving = true): void {
  const dist = g.last ? Math.hypot(x - g.last.x, z - g.last.z) : 0
  g.last = { x, z }
  const instant = moving && delta > 0 && dist < 1 ? dist / delta : 0
  g.speed = smoothSpeed(g.speed, instant, delta)
  g.phase = (g.phase + (g.speed * delta / stride) * Math.PI * 2) % (Math.PI * 2)
}
