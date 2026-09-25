import { describe, expect, it } from 'vitest'
import { StaticColliderRegistry } from '../world/staticColliders'
import { moveZombie, pushOutOfCircle, type MoveEnv } from './zombieMovement'

function env(): MoveEnv {
  const colliders = new StaticColliderRegistry()
  // A thin wall along X at z = 0 (0.3 m thick, 3 m high) from x = -5 to 5, and a lintel above a gap.
  colliders.registerStaticCollider({ id: 'wall', kind: 'wall', min: { x: -5, y: 0, z: -0.15 }, max: { x: 5, y: 3, z: 0.15 } })
  colliders.registerStaticCollider({ id: 'lintel', kind: 'wall', min: { x: 6, y: 2.2, z: -0.15 }, max: { x: 8, y: 3, z: 0.15 } })
  return { colliders, radius: 0.4, height: 1.8, substep: 0.2 }
}

describe('zombie movement (R2, simulation-owned)', () => {
  it('never tunnels through a thin wall, even with a large time step', () => {
    const p = { x: 0, y: 0, z: -2 }
    moveZombie(p, 0, 4, 2, env(), null) // 8 m in one step
    expect(p.z).toBeLessThanOrEqual(-0.15 - 0.4 + 1e-6)
  })

  it('slides along a wall instead of stopping dead', () => {
    const p = { x: 0, y: 0, z: -0.6 }
    moveZombie(p, 2, 2, 0.5, env(), null)
    expect(p.x).toBeGreaterThan(0.9)
    expect(p.z).toBeCloseTo(-0.55, 5)
  })

  it('walks under a lintel (overhead boxes are not obstacles)', () => {
    const p = { x: 7, y: 0, z: -2 }
    moveZombie(p, 0, 2, 2, env(), null)
    expect(p.z).toBeCloseTo(2, 5)
  })

  it('stops at the player instead of overlapping, and zombies share an overlap', () => {
    const p = { x: 0, y: 0, z: -4 }
    moveZombie(p, 0, 2, 1, env(), { x: 0, z: -2.5, r: 0.4 })
    expect(Math.hypot(p.x, p.z + 2.5)).toBeGreaterThanOrEqual(0.8 - 1e-6)
    const a = { x: 0, y: 0, z: 0 }
    pushOutOfCircle(a, 0.4, { x: 0.4, z: 0, r: 0.4 }, 0.5)
    expect(a.x).toBeCloseTo(-0.2, 6)
  })

  it('a door leaf blocks only in its current pose (live state, no re-registration)', () => {
    const e = env()
    let state: 'open' | 'closed' = 'closed'
    e.colliders.registerStaticCollider({ id: 'door:closed', kind: 'door', min: { x: 10, y: 0, z: -0.05 }, max: { x: 11.4, y: 2.2, z: 0.05 }, isSolid: () => state === 'closed' })
    const p = { x: 10.7, y: 0, z: -1 }
    moveZombie(p, 0, 2, 1, e, null)
    expect(p.z).toBeLessThan(-0.4)
    state = 'open'
    moveZombie(p, 0, 2, 1, e, null)
    expect(p.z).toBeGreaterThan(0.5)
  })
})
