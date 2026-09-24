/**
 * Pure procedural animation: simulation state in, joint angles out. Animations are in place
 * (the controller/physics own the position); damage timing stays in combat/AI, the pose only
 * visualises the same progress values, so loops or blends can never emit a second hit.
 *
 * Model space: +Z forward, +Y up, the character's right side is −X. Arms hang along −Y from the
 * shoulder; arm Euler order is YXZ (pitch lifts the arm forward, yaw then sweeps it sideways).
 */
export interface JointAngles {
  x: number
  y: number
  z: number
}

export interface Pose {
  /** Vertical bob of the hips (m). */
  bodyY: number
  /** Whole upper-body lean forward (+) / back (−), radians around X. */
  bodyPitch: number
  torsoTwist: number
  headPitch: number
  headRoll: number
  armL: JointAngles
  armR: JointAngles
  legL: number
  legR: number
  /** Death fall: rotation of the whole model around the feet (−π/2 = lying on its back). */
  rootPitch: number
}

export interface PoseInput {
  kind: 'player' | 'zombie'
  /** Seconds, for idle breathing/sway. */
  time: number
  /** Gait phase in radians, advanced by distance walked so feet do not slide. */
  gaitPhase: number
  /** Horizontal speed (m/s). */
  speed: number
  /** Player melee progress 0..1, or −1 when not swinging. */
  swing: number
  /** Swing progress at which the hit window lands (hitDelay / swingDuration). */
  hitAt: number
  /** Shove progress 0..1, or −1. */
  shove: number
  /** Zombie attack windup progress 0..1 (1 = the hit), or −1. Also used for bashing structures. */
  attack: number
  /** Hit reaction intensity 0..1. */
  hurt: number
  /** Death fall progress 0..1, or −1 while alive. */
  dead: number
  armed: boolean
  /** Seconds into a craft/repair (shared work pose for every timed action), or −1. */
  work: number
}

export const WALK_REFERENCE_SPEED = 2
export const RUN_REFERENCE_SPEED = 7
/** Right arm pitch that points the arm straight forward. */
export const ARM_FORWARD = -Math.PI / 2

export function createPose(): Pose {
  return {
    bodyY: 0, bodyPitch: 0, torsoTwist: 0, headPitch: 0, headRoll: 0,
    armL: { x: 0, y: 0, z: 0 }, armR: { x: 0, y: 0, z: 0 }, legL: 0, legR: 0, rootPitch: 0,
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (t: number) => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Piecewise-linear keyframes [t, value], t ascending. */
function keyframes(t: number, keys: readonly (readonly [number, number])[]): number {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]
    if (t <= t1) {
      const [t0, v0] = keys[i - 1]
      return lerp(v0, v1, smooth((t - t0) / Math.max(1e-6, t1 - t0)))
    }
  }
  return keys[keys.length - 1][1]
}

/** Swing yaw of the weapon arm: wind up to the right, cross the front exactly at the hit, follow through. */
export function swingYaw(progress: number, hitAt: number): number {
  const windup = Math.min(0.2, hitAt * 0.5)
  return keyframes(progress, [[0, 0], [windup, -1.2], [hitAt, 0], [Math.min(0.85, hitAt + 0.4), 1.25], [1, 0.35]])
}

export function swingPitch(progress: number): number {
  return keyframes(progress, [[0, -0.35], [0.18, ARM_FORWARD], [0.8, ARM_FORWARD], [1, -0.6]])
}

export function computePose(input: PoseInput, out: Pose = createPose()): Pose {
  const walk = clamp01(input.speed / WALK_REFERENCE_SPEED)
  const run = clamp01((input.speed - 4) / (RUN_REFERENCE_SPEED - 4))
  const s = Math.sin(input.gaitPhase)
  const breathe = Math.sin(input.time * 2.1)
  const zombie = input.kind === 'zombie'

  const legAmp = zombie ? 0.38 * walk : 0.5 * walk + 0.25 * run
  out.legL = s * legAmp
  out.legR = -s * legAmp
  out.bodyY = Math.abs(s) * (zombie ? 0.03 : 0.045) * walk + 0.008 * breathe * (1 - walk)
  out.bodyPitch = zombie ? 0.14 + 0.04 * walk : 0.16 * run
  out.torsoTwist = 0
  out.headPitch = zombie ? 0.18 : 0
  out.headRoll = zombie ? 0.22 + 0.06 * Math.sin(input.time * 1.3) : 0
  out.rootPitch = 0

  if (zombie) {
    // Classic reach: arms forward, slightly apart, swaying with the shamble.
    const sway = 0.08 * Math.sin(input.time * 1.7) + 0.12 * s * walk
    out.armL.x = -1.25 + sway
    out.armR.x = -1.25 - sway
    out.armL.y = 0
    out.armR.y = 0
    out.armL.z = 0.12
    out.armR.z = -0.12
    if (input.attack >= 0) {
      // Raise both arms over the head, then slam down forward at progress 1 (the damage frame).
      const a = input.attack
      const pitch = keyframes(a, [[0, -1.25], [0.7, -2.6], [1, -1.35]])
      out.armL.x = pitch
      out.armR.x = pitch
      out.bodyPitch += keyframes(a, [[0, 0], [0.7, -0.12], [1, 0.3]])
    }
  } else {
    const armAmp = 0.45 * walk + 0.35 * run
    out.armL.x = -s * armAmp
    out.armL.y = 0
    out.armL.z = 0.06
    out.armR.x = input.armed ? -0.35 + s * armAmp * 0.3 : s * armAmp
    out.armR.y = 0
    out.armR.z = -0.06
    if (input.swing >= 0) {
      const p = clamp01(input.swing)
      out.armR.x = swingPitch(p)
      out.armR.y = swingYaw(p, input.hitAt)
      out.armL.x = -0.4
      out.torsoTwist = out.armR.y * 0.3
    }
    if (input.work >= 0 && input.swing < 0) {
      // Shared work pose: lean over the job, left hand steadies it, right hand taps ~2.5 times/s.
      const tap = Math.sin(input.work * Math.PI * 5)
      out.armL.x = -0.95
      out.armL.y = -0.25
      out.armR.x = -1.05 - 0.35 * tap
      out.armR.y = 0.2
      out.bodyPitch += 0.28
      out.headPitch += 0.4
    }
    if (input.shove >= 0) {
      const bump = keyframes(clamp01(input.shove), [[0, 0], [0.3, 1], [1, 0]])
      out.armL.x = lerp(out.armL.x, -1.45, bump)
      if (input.swing < 0) out.armR.x = lerp(out.armR.x, -1.45, bump)
      out.bodyPitch += 0.18 * bump
    }
  }

  const hurt = clamp01(input.hurt)
  out.bodyPitch -= 0.35 * hurt
  out.headPitch -= 0.25 * hurt

  if (input.dead >= 0) {
    const d = clamp01(input.dead)
    const fall = 1 - (1 - d) * (1 - d)
    out.rootPitch = (-Math.PI / 2) * fall
    out.armL.x = lerp(out.armL.x, -2.6, fall)
    out.armR.x = lerp(out.armR.x, -2.6, fall)
    out.armL.y = lerp(out.armL.y, 0, fall)
    out.armR.y = lerp(out.armR.y, 0, fall)
    out.legL = lerp(out.legL, 0.15, fall)
    out.legR = lerp(out.legR, -0.1, fall)
    out.bodyPitch = lerp(out.bodyPitch, 0, fall)
    out.torsoTwist = lerp(out.torsoTwist, 0, fall)
  }
  return out
}
