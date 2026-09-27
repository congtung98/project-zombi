import { GAME_CONFIG } from '../core/config'
import type { Vec3 } from '../../types'

/**
 * CS1 combat stance: the player's intent (right mouse) and aim, kept apart from the pose. Runtime
 * only (never saved): a load, New Game, pause, blur or death starts from neutral.
 */
export type StanceMode = 'hold' | 'toggle'

export interface StanceControl {
  mode: StanceMode
  /** Toggle mode: latched by right-button press edges. */
  toggled: boolean
  /**
   * Hold mode: the right button must be released before it can ask for the stance again (after E,
   * Esc, an opened UI or a reset while it was held).
   */
  suppressed: boolean
  /** `stanceRequested` for this tick (input intent, not the finished pose). */
  requested: boolean
  /** Desired aim yaw (rad) from the last valid cursor point. */
  aimYaw: number
  /** false until a cursor point far enough from the player gave an aim. */
  hasAim: boolean
  /** Side (+1/−1) of the turn in progress, kept near 180° so the body never flips direction. */
  turnSign: number
  /** Simulation time of the last left click outside the stance (grace for near-simultaneous clicks). */
  clickOutsideAt: number
}

export function createStanceControl(mode: StanceMode = 'hold'): StanceControl {
  return { mode, toggled: false, suppressed: false, requested: false, aimYaw: 0, hasAim: false, turnSign: 1, clickOutsideAt: -Infinity }
}

/**
 * Update the stance request from the right button. `allowed` is false while dead or while a UI panel
 * takes the input: the request drops and a held button must be released first.
 */
export function updateStanceRequest(c: StanceControl, rmbDown: boolean, rmbPressed: boolean, allowed: boolean): boolean {
  if (!allowed) {
    c.requested = false
    c.toggled = false
    c.suppressed = rmbDown
    return false
  }
  if (c.mode === 'toggle') {
    if (rmbPressed) c.toggled = !c.toggled
    c.requested = c.toggled
  } else {
    // A press edge counts even if the button is already up again: a quick right+left click between
    // two slow frames still swings (never lost depending on the frame rate).
    if (c.suppressed && (!rmbDown || rmbPressed)) c.suppressed = false
    c.requested = (rmbDown || rmbPressed) && !c.suppressed
  }
  return c.requested
}

/** Leave the stance (E, Esc, reset): a held button no longer asks for it until released. */
export function cancelStance(c: StanceControl, rmbDown: boolean): void {
  c.requested = false
  c.toggled = false
  c.suppressed = rmbDown
  c.clickOutsideAt = -Infinity
}

/** Mode change from the settings: drops any held or latched request. */
export function setStanceMode(c: StanceControl, mode: StanceMode, rmbDown: boolean): void {
  c.mode = mode
  cancelStance(c, rmbDown)
}

/** Aim yaw toward a cursor point, or null when it sits on the player (keep the previous aim). */
export function aimYawTowards(from: Vec3, cursor: Vec3 | null, minDistance = GAME_CONFIG.combatStance.aimMinDistance): number | null {
  if (!cursor) return null
  const dx = cursor.x - from.x
  const dz = cursor.z - from.z
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) < minDistance) return null
  return Math.atan2(dx, dz)
}

/** Shortest signed turn from `from` to `to`, in (−π, π]; exactly opposite is +π (one fixed side). */
export function angleDiff(from: number, to: number): number {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from))
  return d <= -Math.PI + 1e-9 ? Math.PI : d
}

/** Wrap an angle into (−π, π]. */
export function wrapAngle(a: number): number {
  return angleDiff(0, a)
}

/**
 * Turn `current` toward `target` by at most `maxStep` (rad), the shortest way. Near 180° the side in
 * `state.turnSign` wins unless the aim is clearly on the other side (hysteresis), so a cursor
 * wobbling behind the back never makes the body swing left, right, left.
 */
export function turnToward(current: number, target: number, maxStep: number, state: { turnSign: number }, hysteresis = (GAME_CONFIG.combatStance.turnSideHysteresisDeg * Math.PI) / 180): number {
  let d = angleDiff(current, target)
  if (d === 0) return wrapAngle(current)
  if (Math.sign(d) !== state.turnSign && Math.abs(d) > Math.PI - hysteresis) d = state.turnSign * (2 * Math.PI - Math.abs(d))
  state.turnSign = Math.sign(d)
  const step = Math.min(Math.abs(d), Math.max(0, maxStep))
  return wrapAngle(current + Math.sign(d) * step)
}
