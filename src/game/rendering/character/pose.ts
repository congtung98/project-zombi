import { POSTURES, type ZombiePosture } from './zombieVariants'

/**
 * Pure procedural animation: simulation state in, joint angles out. Animations are in place
 * (the controller/physics own the position); damage timing stays in combat/AI, the pose only
 * visualises the same progress values, so loops or blends can never emit a second hit.
 *
 * Model space: +Z forward, +Y up, the character's right side is −X. Arms hang along −Y from the
 * shoulder; arm Euler order is YXZ (pitch lifts the arm forward, yaw then sweeps it sideways).
 * C1 (character plan): elbows, knees and ankles; the pelvis height follows the legs so the feet stay
 * on the floor when they bend or spread.
 */
export interface JointAngles {
  x: number
  y: number
  z: number
}

export interface Pose {
  /** Vertical offset of the pelvis (m): legs bent or spread lower it so the feet stay on the floor. */
  bodyY: number
  /** Pelvis turn and sideways tilt (weight shift). */
  hipsYaw: number
  hipsRoll: number
  /** Whole upper-body lean forward (+) / back (−), radians around X. */
  bodyPitch: number
  torsoTwist: number
  torsoRoll: number
  headPitch: number
  headYaw: number
  headRoll: number
  armL: JointAngles
  armR: JointAngles
  /** Elbow bend (≤ 0: forearm forward/up). */
  elbowL: number
  elbowR: number
  /** Hip pitch (+ = leg back), sideways spread (+ = outward), knee bend (≥ 0: shin back), ankle pitch. */
  legL: number
  legR: number
  legSplayL: number
  legSplayR: number
  kneeL: number
  kneeR: number
  ankleL: number
  ankleR: number
  /** Death fall: rotation of the whole model around the feet (−π/2 = lying on its back, +π/2 face down). */
  rootPitch: number
  /** Death fall sideways (+π/2 = onto the right side, −X). */
  rootRoll: number
  /** Lift of the whole model while lying, so the body rests on the floor instead of sinking into it. */
  rootLift: number
}

/**
 * C4: how a character falls when it dies (in its own frame): on its back, face down, onto its left
 * (+X) or right (−X) side, or crumpling to its knees where there is no room to fall (a wall).
 */
export const FALL_KINDS = ['back', 'front', 'left', 'right', 'crumple'] as const
export type FallKind = (typeof FALL_KINDS)[number]

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
  /**
   * C3: pelvis turn toward the direction of travel relative to the facing (rad): the legs follow the
   * path, the chest keeps the facing (strafing/backing off while the facing stays on the cursor).
   */
  hipTurn?: number
  /**
   * C4: direction the hit pushes the body, relative to its facing (rad; 0 = pushed forward, i.e. hit
   * from behind; π = pushed back, the default when unknown). Tilts the hit reaction.
   */
  hurtDir?: number
  /**
   * CS1 (player): combat stance blend 0..1 (view-eased from the simulation's posture): the weapon
   * raised over the right shoulder in both hands, or fists up unarmed; knees soft.
   */
  ready?: number
  /** CS1 (player): chest lead toward the aim relative to the body (rad, already limited by the view). */
  aimLead?: number
  /** C4: death fall (default 'back'). */
  fall?: FallKind
  /** C5 (zombies): body posture and gait variant (default 'shambler'). */
  posture?: ZombiePosture
  /** C5 (zombies): 0 = arms hanging (wandering), 1 = reaching for the player (hunting); default 1. */
  reach?: number
}

/** CS1 ready poses: [pitch, yaw, elbow] per arm (right yaw − = cocked to the right, + = across the front). */
const READY_ARMED = { armR: [-1.15, -0.55, -1.05], armL: [-1.09, -0.97, -1.4] } as const
const READY_UNARMED = { armR: [-1.0, 0.3, -1.75], armL: [-1.0, -0.3, -1.75] } as const

export const WALK_REFERENCE_SPEED = 2
export const RUN_REFERENCE_SPEED = 7
/** Right arm pitch that points the arm straight forward. */
export const ARM_FORWARD = -Math.PI / 2
/** Thigh and shin lengths (body.ts): used to keep the feet on the floor when the legs bend. */
export const THIGH = 0.42
export const SHIN = 0.4

export function createPose(): Pose {
  return {
    bodyY: 0, hipsYaw: 0, hipsRoll: 0, bodyPitch: 0, torsoTwist: 0, torsoRoll: 0, headPitch: 0, headYaw: 0, headRoll: 0,
    armL: { x: 0, y: 0, z: 0 }, armR: { x: 0, y: 0, z: 0 }, elbowL: 0, elbowR: 0,
    legL: 0, legR: 0, legSplayL: 0, legSplayR: 0, kneeL: 0, kneeR: 0, ankleL: 0, ankleR: 0, rootPitch: 0, rootRoll: 0, rootLift: 0,
  }
}

/** Vertical reach of a leg from the hip joint to the ankle (m). */
export function legReach(hip: number, knee: number): number {
  return THIGH * Math.cos(hip) + SHIN * Math.cos(hip + knee)
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

/** Weapon elbow: cocked in the wind-up, extended through the hit, eased in the follow-through. */
export function swingElbow(progress: number, hitAt: number): number {
  const windup = Math.min(0.2, hitAt * 0.5)
  return keyframes(progress, [[0, -0.3], [windup, -1.0], [hitAt, -0.12], [Math.min(0.85, hitAt + 0.4), -0.4], [1, -0.3]])
}

interface FallTarget {
  pitch: number
  roll: number
  lift: number
  arm: [number, number]
  armZ: [number, number]
  elbow: [number, number]
  leg: [number, number]
  knee: [number, number]
  ankle: [number, number]
  body: number
  head: number
}

/** Lying (or kneeling) end poses; `lift` keeps the body on the floor (checked in body.test.ts). */
const FALLS: Record<FallKind, FallTarget> = {
  // Arms stay in the plane of the body (at the side, or up past the head) so they rest on the floor.
  back: { pitch: -Math.PI / 2, roll: 0, lift: 0.145, arm: [-0.1, -2.95], armZ: [0.55, -0.35], elbow: [-0.3, -0.45], leg: [-0.3, -0.05], knee: [0.55, 0.12], ankle: [0.2, 0.1], body: 0, head: -0.1 },
  front: { pitch: Math.PI / 2, roll: 0, lift: 0.155, arm: [-2.95, 0.1], armZ: [0.3, -0.45], elbow: [-0.5, -0.2], leg: [0.05, -0.1], knee: [0.1, 0.45], ankle: [0.6, 0.7], body: 0, head: -0.3 },
  left: { pitch: 0, roll: -Math.PI / 2, lift: 0.3, arm: [-1.3, -0.9], armZ: [0.1, -0.1], elbow: [-0.9, -0.5], leg: [-0.45, -0.2], knee: [0.8, 0.5], ankle: [0.2, 0.2], body: 0.25, head: 0.2 },
  right: { pitch: 0, roll: Math.PI / 2, lift: 0.3, arm: [-0.9, -1.3], armZ: [0.1, -0.1], elbow: [-0.5, -0.9], leg: [-0.2, -0.45], knee: [0.5, 0.8], ankle: [0.2, 0.2], body: 0.25, head: 0.2 },
  crumple: { pitch: 0.3, roll: 0, lift: 0.02, arm: [-0.45, -0.3], armZ: [0.08, -0.08], elbow: [-0.3, -0.4], leg: [-0.35, -0.3], knee: [2.0, 1.95], ankle: [0.9, 0.9], body: 0.85, head: 0.55 },
}

/**
 * C4 death: the knees give first (0–30 %), then the body topples around the feet, accelerating like
 * a fall, and lands in the end pose of its fall kind. Progress 1 = the corpse pose (static).
 */
function deathPose(out: Pose, d: number, kind: FallKind): void {
  const t = FALLS[kind]
  const buckle = smooth(clamp01(d / 0.3))
  const topple = clamp01((d - 0.12) / 0.88) ** 2
  const settle = kind === 'crumple' ? buckle : topple
  const give = kind === 'crumple' ? 0 : 0.7 * buckle * (1 - topple)
  out.rootPitch = t.pitch * (kind === 'crumple' ? smooth(clamp01((d - 0.3) / 0.7)) : topple)
  out.rootRoll = t.roll * topple
  out.rootLift = t.lift * topple
  out.armL.x = lerp(out.armL.x, t.arm[0], settle)
  out.armR.x = lerp(out.armR.x, t.arm[1], settle)
  out.armL.y = lerp(out.armL.y, 0, settle)
  out.armR.y = lerp(out.armR.y, 0, settle)
  out.armL.z = lerp(out.armL.z, t.armZ[0], settle)
  out.armR.z = lerp(out.armR.z, t.armZ[1], settle)
  out.elbowL = lerp(out.elbowL, t.elbow[0], settle)
  out.elbowR = lerp(out.elbowR, t.elbow[1], settle)
  out.legL = lerp(out.legL, t.leg[0], settle)
  out.legR = lerp(out.legR, t.leg[1], settle)
  out.kneeL = lerp(out.kneeL, t.knee[0], settle) + give
  out.kneeR = lerp(out.kneeR, t.knee[1], settle) + give
  out.ankleL = lerp(out.ankleL, t.ankle[0], settle) - give
  out.ankleR = lerp(out.ankleR, t.ankle[1], settle) - give
  out.bodyPitch = lerp(out.bodyPitch, t.body, settle) + 0.25 * buckle * (1 - settle)
  out.headPitch = lerp(out.headPitch, t.head, settle)
  out.torsoTwist = lerp(out.torsoTwist, 0, settle)
  out.torsoRoll = lerp(out.torsoRoll, 0, settle)
  out.hipsYaw = lerp(out.hipsYaw, 0, settle)
  out.hipsRoll = lerp(out.hipsRoll, 0, settle)
  out.headYaw = lerp(out.headYaw, 0, settle)
}

export function computePose(input: PoseInput, out: Pose = createPose()): Pose {
  const walk = clamp01(input.speed / WALK_REFERENCE_SPEED)
  const run = clamp01((input.speed - 4) / (RUN_REFERENCE_SPEED - 4))
  const s = Math.sin(input.gaitPhase)
  const c = Math.cos(input.gaitPhase)
  const breathe = Math.sin(input.time * 2.1)
  const zombie = input.kind === 'zombie'

  // Legs: opposite phases; the knee bends while the leg swings forward (left: cos < 0), a little in
  // stance; the ankle keeps the foot near level. C5: zombies by posture (stride, bends, a dragged leg
  // with a short stiff swing).
  const P = POSTURES[input.posture ?? 'shambler']
  const legAmp = zombie ? 0.38 * walk * P.stride : 0.5 * walk + 0.25 * run
  const dragL = zombie && P.drag > 0 ? 0.6 : 1
  const dragR = zombie && P.drag < 0 ? 0.6 : 1
  out.legL = s * legAmp * dragL
  out.legR = -s * legAmp * dragR
  const swingBend = zombie ? P.swingBend * walk : 0.6 * walk + 0.55 * run
  const stanceBend = zombie ? P.stanceBend : 0.04 + 0.06 * walk
  out.kneeL = stanceBend + swingBend * Math.max(0, -c) * (dragL < 1 ? 0.25 : 1)
  out.kneeR = stanceBend + swingBend * Math.max(0, c) * (dragR < 1 ? 0.25 : 1)
  out.ankleL = -(out.legL + out.kneeL) * 0.75
  out.ankleR = -(out.legR + out.kneeR) * 0.75
  out.legSplayL = zombie ? 0.05 : 0.025
  out.legSplayR = out.legSplayL
  // Pelvis turns with the stride (and toward the path), the chest counters it back to the facing.
  const hipTurn = input.hipTurn ?? 0
  const strideYaw = (zombie ? 0.05 : 0.09) * s * walk
  out.hipsYaw = strideYaw + hipTurn
  // A limping zombie lurches its pelvis over the good leg.
  out.hipsRoll = zombie ? P.lurch * s * walk : 0
  out.bodyPitch = zombie ? P.lean + 0.04 * walk : 0.16 * run
  out.torsoTwist = -strideYaw * 0.7 - hipTurn
  out.torsoRoll = zombie ? P.shoulderTilt : 0
  out.headPitch = zombie ? P.headPitch : 0
  out.headYaw = 0
  if (!zombie) {
    // C3 idle: slow weight shift from foot to foot (the free knee bends a little), the pelvis tilts
    // and the chest balances it; the head drifts. Fades out as soon as the character walks.
    const idle = 1 - walk
    const shift = Math.sin(input.time * 0.45)
    out.hipsRoll = 0.028 * shift * idle
    out.torsoRoll = -0.7 * out.hipsRoll
    out.kneeL += 0.08 * Math.max(0, shift) * idle
    out.kneeR += 0.08 * Math.max(0, -shift) * idle
    out.ankleL = -(out.legL + out.kneeL) * 0.75
    out.ankleR = -(out.legR + out.kneeR) * 0.75
    out.headYaw = 0.06 * Math.sin(input.time * 0.31) * idle
  }
  out.headRoll = zombie ? P.headRoll + 0.06 * Math.sin(input.time * P.headSpeed) : 0
  out.rootPitch = 0
  out.rootRoll = 0
  out.rootLift = 0

  if (zombie) {
    // C5: hunting zombies reach forward (the lurcher with one arm), wandering ones let the arms hang
    // and swing loosely with the walk; `reach` blends between the two (eased by the view).
    const r = clamp01(input.reach ?? 1)
    const rR = r * P.reachRight
    const sway = P.sway * 0.7 * Math.sin(input.time * 1.7) + 0.12 * s * walk
    const hangSwing = 0.3 * s * walk
    out.armL.x = lerp(P.hang - hangSwing, P.reach + sway, r)
    out.armR.x = lerp(P.hang + hangSwing, P.reach - sway, rR)
    out.armL.y = 0
    out.armR.y = 0
    out.armL.z = lerp(0.07, 0.12, r)
    out.armR.z = -lerp(0.07, 0.12, rR)
    out.elbowL = lerp(P.hangElbow, -0.14, r)
    out.elbowR = lerp(P.hangElbow, -0.18, rR)
    if (input.attack >= 0) {
      // Raise both arms over the head, then slam down forward at progress 1 (the damage frame).
      const a = input.attack
      const pitch = keyframes(a, [[0, -1.25], [0.7, -2.6], [1, -1.35]])
      out.armL.x = pitch
      out.armR.x = pitch
      const bend = keyframes(a, [[0, -0.15], [0.7, -0.4], [1, -0.05]])
      out.elbowL = bend
      out.elbowR = bend
      out.bodyPitch += keyframes(a, [[0, 0], [0.7, -0.12], [1, 0.3]])
      // The legs brace into the slam.
      const brace = keyframes(a, [[0, 0], [0.7, 0.05], [1, 0.22]])
      out.kneeL += brace
      out.kneeR += brace
    }
  } else {
    const armAmp = 0.45 * walk + 0.35 * run
    out.armL.x = -s * armAmp
    out.armL.y = 0
    out.armL.z = 0.06
    out.armR.x = input.armed ? -0.35 + s * armAmp * 0.3 : s * armAmp
    out.armR.y = 0
    out.armR.z = -0.06
    // Elbows: relaxed, bending more as the arm swings forward; runners hold them near 90°.
    out.elbowL = lerp(-0.14 - 0.4 * Math.max(0, -out.armL.x), -1.3, run)
    out.elbowR = input.armed ? -0.12 : lerp(-0.14 - 0.4 * Math.max(0, -out.armR.x), -1.3, run)
    // CS1 ready stance: blended in over the walk arms; a swing starts from it and returns to it.
    const ready = input.work >= 0 ? 0 : smooth(clamp01(input.ready ?? 0))
    if (ready > 0) {
      const R = input.armed ? READY_ARMED : READY_UNARMED
      out.armR.x = lerp(out.armR.x, R.armR[0], ready)
      out.armR.y = lerp(out.armR.y, R.armR[1], ready)
      out.elbowR = lerp(out.elbowR, R.armR[2], ready)
      out.armL.x = lerp(out.armL.x, R.armL[0], ready)
      out.armL.y = lerp(out.armL.y, R.armL[1], ready)
      out.elbowL = lerp(out.elbowL, R.armL[2], ready)
      out.kneeL += 0.1 * ready
      out.kneeR += 0.1 * ready
      out.bodyPitch += 0.06 * ready
    }
    const readyArmR = [out.armR.x, out.armR.y, out.elbowR] as const
    const readyArmL = [out.armL.x, out.armL.y, out.elbowL] as const
    if (input.swing >= 0) {
      // C4: the whole upper body swings: the chest winds up with the arm and drives through the hit,
      // the pelvis follows a little, the body leans into the contact, the eyes stay on the target.
      // The arm still crosses the front exactly at `hitAt` (the damage frame of the combat system).
      const p = clamp01(input.swing)
      out.armR.x = swingPitch(p)
      out.armR.y = swingYaw(p, input.hitAt)
      out.elbowR = swingElbow(p, input.hitAt)
      out.torsoTwist += out.armR.y * 0.45
      out.hipsYaw += out.armR.y * 0.15
      out.bodyPitch += keyframes(p, [[0, 0], [Math.min(0.2, input.hitAt * 0.5), -0.06], [input.hitAt, 0.14], [1, 0.03]])
      out.headYaw = -out.armR.y * 0.5
      if (input.armed) {
        // Two-handed grip preset: the left hand follows the right one onto the handle.
        out.armL.x = out.armR.x * 0.95
        out.armL.y = out.armR.y - 0.42
        out.elbowL = out.elbowR - 0.35
      } else {
        out.armL.x = -0.4
        out.elbowL = -0.5
      }
      if (ready > 0) {
        // CS1: leave the ready pose during the wind-up and settle back into it after the follow-through
        // (the damage frame in between is the plain swing, unchanged).
        const windupEnd = Math.min(0.2, input.hitAt * 0.5)
        const hold = ready * Math.max(1 - smooth(clamp01(p / windupEnd)), smooth(clamp01((p - 0.8) / 0.2)))
        out.armR.x = lerp(out.armR.x, readyArmR[0], hold)
        out.armR.y = lerp(out.armR.y, readyArmR[1], hold)
        out.elbowR = lerp(out.elbowR, readyArmR[2], hold)
        out.armL.x = lerp(out.armL.x, readyArmL[0], hold)
        out.armL.y = lerp(out.armL.y, readyArmL[1], hold)
        out.elbowL = lerp(out.elbowL, readyArmL[2], hold)
      }
    }
    // CS1: the chest (and a little the head) leads toward the aim while the body turns.
    const lead = input.aimLead ?? 0
    out.torsoTwist += lead * 0.8
    out.headYaw += lead * 0.25
    if (input.work >= 0 && input.swing < 0) {
      // Shared work pose: lean over the job, left hand steadies it, right hand taps ~2.5 times/s.
      const tap = Math.sin(input.work * Math.PI * 5)
      out.armL.x = -0.95
      out.armL.y = -0.25
      out.armR.x = -1.05 - 0.35 * tap
      out.armR.y = 0.2
      out.elbowL = -0.55
      out.elbowR = -0.6 - 0.2 * tap
      out.bodyPitch += 0.28
      out.headPitch += 0.4
    }
    if (input.shove >= 0) {
      const bump = keyframes(clamp01(input.shove), [[0, 0], [0.3, 1], [1, 0]])
      out.armL.x = lerp(out.armL.x, -1.45, bump)
      out.elbowL = lerp(out.elbowL, -0.15, bump)
      if (input.swing < 0) {
        out.armR.x = lerp(out.armR.x, -1.45, bump)
        out.elbowR = lerp(out.elbowR, -0.15, bump)
      }
      out.bodyPitch += 0.18 * bump
    }
  }

  // C4 hit reaction: a short flinch away from the blow (lean along the push, head snaps, knees give,
  // arms come up a little). It never cancels a swing or a step: it only adds to the pose.
  const hurt = clamp01(input.hurt)
  if (hurt > 0) {
    const dir = input.hurtDir ?? Math.PI
    out.bodyPitch += 0.35 * hurt * Math.cos(dir)
    out.torsoRoll -= 0.3 * hurt * Math.sin(dir)
    out.headPitch -= 0.25 * hurt
    out.headRoll -= 0.2 * hurt * Math.sin(dir)
    out.kneeL += 0.25 * hurt
    out.kneeR += 0.25 * hurt
    if (input.swing < 0 && input.attack < 0) {
      out.elbowL -= 0.4 * hurt
      out.elbowR -= 0.4 * hurt
    }
  }

  if (input.dead >= 0) deathPose(out, clamp01(input.dead), input.fall ?? 'back')

  // Feet on the floor: the pelvis drops by what the longer leg lost to bending or spreading, plus a
  // barely visible breath while standing.
  const reach = Math.max(legReach(out.legL, out.kneeL), legReach(out.legR, out.kneeR))
  out.bodyY = reach - (THIGH + SHIN) + 0.006 * breathe * (1 - walk)
  return out
}
