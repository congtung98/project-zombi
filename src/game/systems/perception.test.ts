import { describe, expect, it } from 'vitest'
import { applyKnockback, stepZombie, type DoorInfo, type ZombieAIContext } from './ai'
import { createZombieState, type ZombieState } from '../entities/zombie'
import { GAME_CONFIG } from '../core/config'
import type { Vec3 } from '../../types'

const cfg = GAME_CONFIG.zombie
const hearing = GAME_CONFIG.hearing
const structure = GAME_CONFIG.structure
const DT = 1 / 60

function zombieAt(x: number, z: number, facing = 0): ZombieState {
  const zombie = createZombieState('z1', { x, y: 0, z })
  zombie.facing = facing // 0 = looking towards +Z
  return zombie
}

function run(z: ZombieState, target: Vec3, seconds: number, ctx?: ZombieAIContext, alive = true) {
  const results = []
  for (let t = 0; t < seconds; t += DT) results.push(stepZombie(z, target, alive, DT, cfg, ctx))
  return results
}

describe('P2-S5 perception: sight cone', () => {
  it('an unaware zombie sees ahead within range but not behind it', () => {
    const ahead = zombieAt(0, 0)
    stepZombie(ahead, { x: 0, y: 0, z: 6 }, true, DT)
    expect(ahead.ai).toBe('CHASE')
    expect(ahead.memorySource).toBe('sight')

    const behind = zombieAt(0, 0)
    run(behind, { x: 0, y: 0, z: -6 }, 3)
    expect(behind.ai).toBe('IDLE')
    expect(behind.lastKnownTarget).toBeNull()
  })

  it('the cone is ±viewHalfAngle; anything within closeSenseRange is noticed from any side', () => {
    const edge = (deg: number) => {
      const z = zombieAt(0, 0)
      const a = (deg * Math.PI) / 180
      stepZombie(z, { x: Math.sin(a) * 5, y: 0, z: Math.cos(a) * 5 }, true, DT)
      return z.ai
    }
    expect(edge(cfg.viewHalfAngleDeg - 5)).toBe('CHASE')
    expect(edge(cfg.viewHalfAngleDeg + 5)).toBe('IDLE')
    const touch = zombieAt(0, 0)
    stepZombie(touch, { x: 0, y: 0, z: -(cfg.closeSenseRange - 0.1) }, true, DT)
    expect(touch.ai).toBe('CHASE')
  })

  it('a hunting zombie tracks all around (no cone) out to chaseRange', () => {
    const z = zombieAt(0, 0)
    z.ai = 'SEARCH'
    z.lastKnownTarget = { x: 0, y: 0, z: 1 }
    z.memorySource = 'noise'
    stepZombie(z, { x: 0, y: 0, z: -(cfg.chaseRange - 1) }, true, DT)
    expect(z.ai).toBe('CHASE')
  })

  it('walls block sight', () => {
    const z = zombieAt(0, 0)
    run(z, { x: 0, y: 0, z: 3 }, 2, { canReach: () => false })
    expect(z.ai).toBe('IDLE')
  })
})

describe('P2-S5 perception: footsteps', () => {
  const noisy = (radius: number, reach = true): ZombieAIContext => ({ canReach: () => reach, noiseRadius: () => radius })

  it('hears walking footsteps within the fixed radius from behind, then searches the heard spot', () => {
    const z = zombieAt(0, 0)
    const target = { x: 0, y: 0, z: -(hearing.walkRadius - 0.5) }
    stepZombie(z, target, true, DT, cfg, noisy(hearing.walkRadius))
    expect(z.memorySource).toBe('noise')
    expect(z.lastKnownTarget).toEqual(target)
    stepZombie(z, target, true, DT, cfg, noisy(hearing.walkRadius))
    expect(z.ai).toBe('SEARCH')
    // Heading to where the noise came from (-Z).
    expect(stepZombie(z, target, true, DT, cfg, noisy(0)).velocity.z).toBeLessThan(0)
  })

  it('does not hear beyond the radius, nor a player standing still right behind it', () => {
    const far = zombieAt(0, 0)
    run(far, { x: 0, y: 0, z: -(hearing.walkRadius + 0.5) }, 2, noisy(hearing.walkRadius))
    expect(far.ai).toBe('IDLE')
    const silent = zombieAt(0, 0)
    run(silent, { x: 0, y: 0, z: -2 }, 2, noisy(0))
    expect(silent.ai).toBe('IDLE')
    // Running is louder: the same distance is heard.
    run(far, { x: 0, y: 0, z: -(hearing.walkRadius + 0.5) }, cfg.detectInterval + DT, noisy(hearing.runRadius))
    expect(far.lastKnownTarget).not.toBeNull()
  })

  it('walls muffle footsteps to wallFactor × radius', () => {
    const inside = hearing.walkRadius * hearing.wallFactor
    const near = zombieAt(0, 0)
    stepZombie(near, { x: 0, y: 0, z: -(inside - 0.3) }, true, DT, cfg, noisy(hearing.walkRadius, false))
    expect(near.memorySource).toBe('noise')
    const through = zombieAt(0, 0)
    run(through, { x: 0, y: 0, z: -(inside + 0.5) }, 2, noisy(hearing.walkRadius, false))
    expect(through.lastKnownTarget).toBeNull()
  })

  it('forgets a memory after memoryDuration if it never arrives', () => {
    const z = zombieAt(0, 0)
    stepZombie(z, { x: 0, y: 0, z: -3 }, true, DT, cfg, noisy(hearing.walkRadius))
    const stuck: ZombieAIContext = { canReach: () => false, findPath: () => null, hasLineOfWalk: () => false }
    run(z, { x: 40, y: 0, z: 40 }, cfg.memoryDuration - 1, stuck)
    expect(z.ai).toBe('SEARCH')
    run(z, { x: 40, y: 0, z: 40 }, 1.5, stuck)
    expect(z.ai).toBe('IDLE')
    expect(z.lastKnownTarget).toBeNull()
  })

  it('getting hit or shoved while unaware makes it search where the blow came from', () => {
    const z = zombieAt(0, 0)
    applyKnockback(z, { x: 0, y: 0, z: -1 }, 1, 0.2)
    expect(z.lastKnownTarget).toEqual({ x: 0, y: 0, z: -1 })
    run(z, { x: 0, y: 0, z: -30 }, 0.4)
    expect(z.ai).toBe('SEARCH')
  })
})

describe('P2-S5 wander and migration', () => {
  it('rests, walks to a picked destination at wander speed, rests again, then picks a new one', () => {
    const z = zombieAt(0, 0)
    const picks: Vec3[] = [{ x: 3, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }]
    let calls = 0
    const ctx: ZombieAIContext = { canReach: () => false, pickWanderPoint: () => picks[calls++ % picks.length], random: () => 0 }
    const first = stepZombie(z, { x: 50, y: 0, z: 50 }, true, DT, cfg, ctx)
    expect(first.transition).toEqual({ from: 'IDLE', to: 'WANDER' })
    const walk = stepZombie(z, { x: 50, y: 0, z: 50 }, true, DT, cfg, ctx)
    expect(walk.velocity.x).toBeCloseTo(cfg.wanderSpeed)
    z.position = { x: 3, y: 0, z: 0 } // physics brought it there
    const arrive = stepZombie(z, { x: 50, y: 0, z: 50 }, true, DT, cfg, ctx)
    expect(arrive.transition).toEqual({ from: 'WANDER', to: 'IDLE' })
    expect(z.restTimer).toBeCloseTo(cfg.wanderRestMin)
    // Resting: no movement, no new pick until the rest is over.
    const resting = run(z, { x: 50, y: 0, z: 50 }, cfg.wanderRestMin - 0.1, ctx)
    expect(resting.every((r) => r.velocity.x === 0 && r.velocity.z === 0)).toBe(true)
    expect(calls).toBe(1)
    run(z, { x: 50, y: 0, z: 50 }, 0.2, ctx)
    expect(z.ai).toBe('WANDER')
    expect(z.moveTarget).toEqual({ x: 0, y: 0, z: 3 })
  })

  it('stays IDLE when no destination is reachable, and gives up a leg that takes too long', () => {
    const z = zombieAt(0, 0)
    run(z, { x: 50, y: 0, z: 50 }, 5, { canReach: () => false, pickWanderPoint: () => null })
    expect(z.ai).toBe('IDLE')
    const blocked = zombieAt(0, 0)
    run(blocked, { x: 50, y: 0, z: 50 }, cfg.wanderTimeout + 0.5, { canReach: () => false, pickWanderPoint: () => ({ x: 9, y: 0, z: 0 }), random: () => 0.99 })
    expect(blocked.ai).toBe('IDLE')
  })

  it('MIGRATE walks at migration speed without resting and returns to IDLE on arrival; sight interrupts it', () => {
    const z = zombieAt(0, 0)
    z.ai = 'MIGRATE'
    z.moveTarget = { x: 10, y: 0, z: 0 }
    const ctx: ZombieAIContext = { canReach: () => false, pickWanderPoint: () => null }
    expect(stepZombie(z, { x: 50, y: 0, z: 50 }, true, DT, cfg, ctx).velocity.x).toBeCloseTo(cfg.migrateSpeed)
    z.position = { x: 10, y: 0, z: 0 }
    expect(stepZombie(z, { x: 50, y: 0, z: 50 }, true, DT, cfg, ctx).transition).toEqual({ from: 'MIGRATE', to: 'IDLE' })

    const seen = zombieAt(0, 0)
    seen.ai = 'MIGRATE'
    seen.moveTarget = { x: 0, y: 0, z: 10 }
    stepZombie(seen, { x: 0, y: 0, z: 5 }, true, DT)
    expect(seen.ai).toBe('CHASE')
    expect(seen.moveTarget).toBeNull()
  })
})

describe('P2-S5 door siege FSM', () => {
  const doorCenter = { x: 0, y: 0, z: 3 }
  const slot = { x: 0, y: 0, z: 4.05 }
  function siegeCtx(door: DoorInfo, slots: { free: boolean } = { free: true }): ZombieAIContext {
    return {
      canReach: () => false,
      findPath: (_a, b) => [{ ...b }],
      hasLineOfWalk: (_a, b) => b.z > 3.5, // the door plane blocks
      findDoorRoute: () => ({ doorId: 'door', approach: { x: 0, y: 0, z: 4.05 }, side: 1 }),
      getDoor: () => door,
      claimDoorSlot: () => (slots.free ? slot : null),
    }
  }
  function searching(z: number): ZombieState {
    const zombie = zombieAt(0, z, Math.PI)
    zombie.ai = 'SEARCH'
    zombie.lastKnownTarget = { x: 0, y: 0, z: 0 } // inside, behind the closed door
    zombie.memorySource = 'sight'
    return zombie
  }

  it('SEARCH blocked by a closed door → APPROACH the slot → ATTACK_STRUCTURE: one hit every 1.2 s', () => {
    const door: DoorInfo = { state: 'closed', center: doorCenter }
    const ctx: ZombieAIContext = { ...siegeCtx(door), findPath: () => null }
    const z = searching(8)
    run(z, { x: 0, y: 0, z: 0 }, 0.1, ctx)
    expect(z.ai).toBe('APPROACH_STRUCTURE')
    expect(z.structureTargetId).toBe('door')
    z.position = { ...slot }
    run(z, { x: 0, y: 0, z: 0 }, DT * 2, ctx)
    expect(z.ai).toBe('ATTACK_STRUCTURE')
    const hits = run(z, { x: 0, y: 0, z: 0 }, 6, ctx).filter((r) => r.structureHit === 'door').length
    const period = cfg.attackWindup + structure.cooldown
    expect(hits).toBeGreaterThanOrEqual(Math.floor(6 / period))
    expect(hits).toBeLessThanOrEqual(Math.ceil(6 / period))
    // Faces the door (-Z) while bashing.
    expect(Math.cos(z.facing)).toBeLessThan(-0.9)
  })

  it('opening the door during the windup cancels the hit and sends it searching', () => {
    const door: DoorInfo = { state: 'closed', center: doorCenter }
    const z = searching(4.05)
    z.ai = 'ATTACK_STRUCTURE'
    z.structureTargetId = 'door'
    z.structureSide = 1
    const ctx = siegeCtx(door)
    run(z, { x: 0, y: 0, z: 0 }, cfg.attackWindup * 0.5, ctx)
    expect(z.attackWindup).toBeGreaterThan(0)
    door.state = 'open'
    const after = run(z, { x: 0, y: 0, z: 0 }, 1, ctx)
    expect(after.some((r) => r.structureHit)).toBe(false)
    expect(z.ai).toBe('SEARCH')
    expect(z.structureTargetId).toBeNull()
    expect(z.memoryAge).toBeLessThan(1.1) // fresh search window after the breach/open
  })

  it('without a free slot it queues at queueDistance and never hits from there', () => {
    const door: DoorInfo = { state: 'closed', center: doorCenter }
    const slots = { free: false }
    const z = searching(3 + structure.queueDistance - 0.2)
    z.ai = 'APPROACH_STRUCTURE'
    z.structureTargetId = 'door'
    z.structureSide = 1
    const results = run(z, { x: 0, y: 0, z: 0 }, 3, siegeCtx(door, slots))
    expect(z.ai).toBe('APPROACH_STRUCTURE')
    expect(results.every((r) => r.velocity.z === 0 && !r.structureHit)).toBe(true)
  })

  it('gives up the siege after siegeHold without new information, but new noise keeps it going', () => {
    const door: DoorInfo = { state: 'closed', center: doorCenter }
    const z = searching(4.05)
    z.ai = 'ATTACK_STRUCTURE'
    z.structureTargetId = 'door'
    z.structureSide = 1
    run(z, { x: 0, y: 0, z: 0 }, structure.siegeHold - 5, siegeCtx(door))
    expect(z.ai).toBe('ATTACK_STRUCTURE')
    // Footsteps inside (muffled radius) refresh the siege.
    run(z, { x: 0, y: 0, z: 2.5 }, 0.3, { ...siegeCtx(door), noiseRadius: () => hearing.walkRadius })
    run(z, { x: 0, y: 0, z: 0 }, 10, siegeCtx(door))
    expect(z.ai).toBe('ATTACK_STRUCTURE')
    run(z, { x: 0, y: 0, z: 0 }, structure.siegeHold, siegeCtx(door))
    expect(z.ai).toBe('IDLE')
    expect(z.lastKnownTarget).toBeNull()
  })

  it('no route even through doors: SEARCH gives up instead of hitting walls forever', () => {
    const z = searching(8)
    run(z, { x: 0, y: 0, z: 0 }, 0.2, { canReach: () => false, findPath: () => null, hasLineOfWalk: () => false, findDoorRoute: () => null })
    expect(z.ai).toBe('IDLE')
  })
})
