import type { Vec3 } from '../../types'
import type { StaticColliderRegistry } from '../world/staticColliders'

/**
 * R2: zombie movement owned by the simulation. The AI decides a velocity; this integrates it and
 * resolves collisions in the ground plane: a circle (the zombie capsule seen from above) against the
 * solid boxes of `StaticColliderRegistry`, the player's circle and other zombies. No Rapier, no
 * WebGL: a zombie with no physics body (NEAR/DORMANT, tests) moves exactly the same way. Rapier only
 * mirrors ACTIVE zombies with a kinematic body so the player bumps into them.
 */

export interface MoveEnv {
  colliders: StaticColliderRegistry
  radius: number
  /** Boxes whose bottom is at or above this height (door lintels) are overhead, not obstacles. */
  height: number
  /** Longest distance per collision sub-step (no tunnelling through thin walls). */
  substep: number
}

export interface Circle {
  x: number
  z: number
  r: number
}

/** Boxes lower than this (road decals, floors) never block. */
const MIN_TOP = 0.05
const EPS = 1e-9

/** Move by (vx, vz)·dt in sub-steps, pushing out of solid boxes after each; returns collision count. */
export function moveZombie(position: Vec3, vx: number, vz: number, dt: number, env: MoveEnv, avoid: Circle | null): number {
  const dx = vx * dt
  const dz = vz * dt
  const len = Math.hypot(dx, dz)
  const steps = Math.max(1, Math.ceil(len / env.substep))
  let contacts = 0
  for (let i = 0; i < steps; i++) {
    position.x += dx / steps
    position.z += dz / steps
    contacts += resolveStatic(position, env)
    if (avoid) pushOutOfCircle(position, env.radius, avoid)
  }
  return contacts
}

/** Push a circle out of every solid box it overlaps (two passes settle corners). */
export function resolveStatic(position: Vec3, env: MoveEnv): number {
  const r = env.radius
  let contacts = 0
  for (let pass = 0; pass < 2; pass++) {
    const boxes = env.colliders.querySolid(position.x - r, position.z - r, position.x + r, position.z + r)
    let moved = false
    for (const c of boxes) {
      if (c.min.y >= env.height || c.max.y <= MIN_TOP) continue
      const cx = Math.min(Math.max(position.x, c.min.x), c.max.x)
      const cz = Math.min(Math.max(position.z, c.min.z), c.max.z)
      const ox = position.x - cx
      const oz = position.z - cz
      const d2 = ox * ox + oz * oz
      if (d2 >= r * r) continue
      contacts += 1
      moved = true
      if (d2 > EPS) {
        const d = Math.sqrt(d2)
        position.x += (ox / d) * (r - d)
        position.z += (oz / d) * (r - d)
      } else {
        // Centre inside the box: leave through the nearest face.
        const left = position.x - c.min.x
        const right = c.max.x - position.x
        const back = position.z - c.min.z
        const front = c.max.z - position.z
        const m = Math.min(left, right, back, front)
        if (m === left) position.x = c.min.x - r
        else if (m === right) position.x = c.max.x + r
        else if (m === back) position.z = c.min.z - r
        else position.z = c.max.z + r
      }
    }
    if (!moved) break
  }
  return contacts
}

/**
 * Keep a circle of radius `r` at `position` outside `other`. `share` = the part of the overlap this
 * circle resolves: 1 against the player (the zombie yields), 0.5 between two zombies (each moves half).
 */
export function pushOutOfCircle(position: Vec3, r: number, other: Circle, share = 1): boolean {
  const ox = position.x - other.x
  const oz = position.z - other.z
  const min = r + other.r
  const d2 = ox * ox + oz * oz
  if (d2 >= min * min) return false
  const d = Math.sqrt(d2)
  if (d > EPS) {
    position.x += (ox / d) * (min - d) * share
    position.z += (oz / d) * (min - d) * share
  } else {
    position.x += min * share
  }
  return true
}
