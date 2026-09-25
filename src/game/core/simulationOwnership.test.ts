import { describe, expect, it } from 'vitest'
import { GameRuntime, type ZombieBodyProxy } from './runtime'
import { GAME_CONFIG } from './config'
import { NEIGHBORHOOD_MAP } from '../world/mapData'
import { buildStressMap } from '../world/stressMap'
import type { Vec3 } from '../../types'

/**
 * R2 acceptance: the simulation owns zombie transforms. Zombies move, think, change state and
 * navigate with no visual and no Rapier body; a body mounted/unmounted for an ACTIVE zombie only
 * mirrors the simulation; far zombies get fewer AI updates; A* goes through a budgeted queue.
 */

const DT = 1 / 30
const R = GAME_CONFIG.zombie.radius

function losGrid(rt: GameRuntime): void {
  rt.setLineOfSightOverride({ isBlocked: (a, b, ignore) => (ignore.length > 0 ? false : !rt.nav.hasLineOfWalk(a, b)) })
}

/** Deepest overlap (m) of a zombie circle with a solid box between the ankles and the head. */
function worstPenetration(rt: GameRuntime): number {
  let worst = 0
  for (const z of rt.zombies.values()) {
    if (z.ai === 'DEAD') continue
    const p = z.position
    for (const c of rt.staticColliders.querySolid(p.x - R, p.z - R, p.x + R, p.z + R)) {
      if (c.min.y >= GAME_CONFIG.zombie.height || c.max.y <= 0.05) continue
      const dx = p.x - Math.min(Math.max(p.x, c.min.x), c.max.x)
      const dz = p.z - Math.min(Math.max(p.z, c.min.z), c.max.z)
      worst = Math.max(worst, R - Math.hypot(dx, dz))
    }
  }
  return worst
}

describe('R2: zombie simulation owns its transform', () => {
  it('zombies wander and move with no body or view, and never sink into walls', () => {
    const rt = new GameRuntime(NEIGHBORHOOD_MAP)
    rt.newGame(31)
    losGrid(rt)
    rt.hordeTimer = 1e9
    const start = new Map(Array.from(rt.zombies.values(), (z) => [z.id, { ...z.position }]))
    let worst = 0
    for (let t = 0; t < 60; t += DT) {
      rt.tick(DT)
      worst = Math.max(worst, worstPenetration(rt))
    }
    const moved = Array.from(start.keys()).filter((id) => {
      const z = rt.zombies.get(id)
      const s = start.get(id)!
      return z !== undefined && Math.hypot(z.position.x - s.x, z.position.z - s.z) > 1
    })
    expect(moved.length).toBeGreaterThanOrEqual(start.size / 2)
    expect(worst).toBeLessThan(0.02)
  })

  it('mounting and unmounting a physics body (ZombieView/ZombieBody) changes nothing in the simulation', () => {
    const run = (withBody: boolean) => {
      const rt = new GameRuntime(NEIGHBORHOOD_MAP)
      rt.newGame(77)
      losGrid(rt)
      const pushed: Vec3[] = []
      const body: ZombieBodyProxy = { setNextKinematicTranslation: (t) => void pushed.push({ ...t }) }
      for (let i = 0; i < 20 / DT; i++) {
        if (withBody && i === Math.round(5 / DT)) rt.registerZombieBody('zombie-1', body)
        if (withBody && i === Math.round(12 / DT)) rt.registerZombieBody('zombie-1', null)
        rt.tick(DT)
        if (withBody && pushed.length > 0 && i < Math.round(12 / DT)) {
          // The body only receives the simulation position (feet on the ground → capsule centre).
          const z = rt.zombies.get('zombie-1')!
          expect(pushed.at(-1)).toEqual({ x: z.position.x, y: GAME_CONFIG.zombie.height / 2, z: z.position.z })
        }
      }
      return { state: Array.from(rt.zombies.values(), (z) => [z.id, z.ai, z.position.x, z.position.z, z.health]), pushed: pushed.length }
    }
    const a = run(false)
    const b = run(true)
    expect(b.state).toEqual(a.state)
    expect(b.pushed).toBeGreaterThan(100)
  })

  it('on a large map only nearby zombies are ACTIVE, AI runs well below one update per zombie per tick', () => {
    const rt = new GameRuntime(buildStressMap(4))
    rt.newGame(5)
    losGrid(rt)
    const levels: string[] = []
    rt.events.on('zombie:levelChanged', (e) => levels.push(`${e.from}->${e.to}`))
    for (let t = 0; t < 20; t += DT) rt.tick(DT)
    // Average over the perf window (the last 120 ticks).
    const updates = rt.perf.snapshot().avgCount.aiUpdates
    const counts = rt.aiScheduler.countLevels(rt.zombies.values())
    expect(counts.ACTIVE).toBeGreaterThan(0)
    expect(counts.ACTIVE).toBeLessThan(40)
    expect(counts.NEAR + counts.DORMANT).toBeGreaterThan(100)
    expect(updates).toBeLessThan(rt.zombies.size * 0.4)

    // Teleporting the player across the map re-levels zombies (views mount/unmount on these events).
    rt.player.position = { x: 60, y: 0, z: 60 }
    for (let t = 0; t < 1; t += DT) rt.tick(DT)
    expect(levels.some((l) => l.endsWith('->ACTIVE'))).toBe(true)
    expect(levels.some((l) => l.startsWith('ACTIVE->'))).toBe(true)
  })

  it('DORMANT zombies still wander (slowly updated, sub-stepped, never through walls)', () => {
    const rt = new GameRuntime(buildStressMap(4))
    rt.newGame(9)
    losGrid(rt)
    const dormant = Array.from(rt.zombies.values()).filter((z) => z.simLevel === 'DORMANT')
    expect(dormant.length).toBeGreaterThan(50)
    const start = new Map(dormant.map((z) => [z.id, { ...z.position }]))
    let worst = 0
    for (let t = 0; t < 90; t += DT) {
      rt.tick(DT)
      if (Math.round(t / DT) % 30 === 0) worst = Math.max(worst, worstPenetration(rt))
    }
    const moved = dormant.filter((z) => Math.hypot(z.position.x - start.get(z.id)!.x, z.position.z - start.get(z.id)!.z) > 1)
    expect(moved.length).toBeGreaterThan(dormant.length / 3)
    expect(worst).toBeLessThan(0.02)
  })

  it('path requests go through the queue: one per zombie at most, served within the per-tick budget', () => {
    const rt = new GameRuntime(buildStressMap(4))
    rt.newGame(3)
    losGrid(rt)
    rt.pathBudget = { maxPathsPerTick: 3, maxPathMs: Infinity, warmMs: 0 }
    // Everyone hears the player at once: a request storm.
    for (const z of rt.zombies.values()) {
      z.lastKnownTarget = { ...rt.player.position }
      z.memorySource = 'noise'
      z.ai = 'SEARCH'
    }
    let maxQueue = 0
    let maxServed = 0
    for (let t = 0; t < 10; t += DT) {
      const before = rt.pathQueue.stats.served
      rt.tick(DT)
      maxServed = Math.max(maxServed, rt.pathQueue.stats.served - before)
      maxQueue = Math.max(maxQueue, rt.pathQueue.size)
      for (const z of rt.zombies.values()) expect(z.pathPending).toBe(rt.pathQueue.has(z.id))
    }
    expect(maxServed).toBeLessThanOrEqual(3)
    expect(maxQueue).toBeLessThanOrEqual(rt.zombies.size)
    expect(maxQueue).toBeGreaterThan(3)
    expect(rt.pathQueue.stats.served).toBeGreaterThan(20)
  })

  it('save/load keeps positions and AI state; the scheduler and queue restart clean', () => {
    const rt = new GameRuntime(NEIGHBORHOOD_MAP)
    rt.newGame(12)
    losGrid(rt)
    for (let t = 0; t < 15; t += DT) rt.tick(DT)
    const snap = JSON.parse(JSON.stringify(rt.createSnapshot()))
    const rt2 = new GameRuntime(NEIGHBORHOOD_MAP)
    rt2.loadSnapshot(snap)
    expect({ ...rt2.createSnapshot(), savedAt: 0 }).toEqual({ ...snap, savedAt: 0 })
    expect(rt2.pathQueue.size).toBe(0)
    for (const z of rt2.zombies.values()) expect(['ACTIVE', 'NEAR', 'DORMANT']).toContain(z.simLevel)
    losGrid(rt2)
    for (let t = 0; t < 5; t += DT) rt2.tick(DT)
    expect(rt2.player.alive).toBe(true)
  })
})
