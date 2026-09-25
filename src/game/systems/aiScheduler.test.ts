import { describe, expect, it } from 'vitest'
import { GAME_CONFIG } from '../core/config'
import { createZombieState, type ZombieState } from '../entities/zombie'
import { AIScheduler, levelForDistance, type ScheduledUpdate } from './aiScheduler'

const CFG = GAME_CONFIG.simulation
const PLAYER = { x: 0, y: 0, z: 0 }

function zombiesAt(distances: number[]): Map<string, ZombieState> {
  const m = new Map<string, ZombieState>()
  distances.forEach((d, i) => m.set(`zombie-${i + 1}`, createZombieState(`zombie-${i + 1}`, { x: d, y: 0, z: 0 })))
  return m
}

function run(s: AIScheduler, zombies: Map<string, ZombieState>, seconds: number, dt = 1 / 60): Map<string, { runs: number; time: number }> {
  const out: ScheduledUpdate[] = []
  const tally = new Map<string, { runs: number; time: number }>()
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    s.updateLevels(zombies.values(), PLAYER, dt, () => undefined)
    for (const u of s.plan(zombies, PLAYER, dt, out)) {
      const e = tally.get(u.zombie.id) ?? { runs: 0, time: 0 }
      e.runs += 1
      e.time += u.dt
      tally.set(u.zombie.id, e)
    }
  }
  return tally
}

describe('AI scheduler (R2)', () => {
  it('levels from distance with a hysteresis band', () => {
    expect(levelForDistance(10, null, CFG)).toBe('ACTIVE')
    expect(levelForDistance(40, null, CFG)).toBe('NEAR')
    expect(levelForDistance(80, null, CFG)).toBe('DORMANT')
    // Just past the edge: keeps its level inside the band, changes beyond it.
    expect(levelForDistance(CFG.activeDistance + 0.5, 'ACTIVE', CFG)).toBe('ACTIVE')
    expect(levelForDistance(CFG.activeDistance + CFG.levelHysteresis, 'ACTIVE', CFG)).toBe('NEAR')
    expect(levelForDistance(CFG.activeDistance - 0.5, 'NEAR', CFG)).toBe('NEAR')
    expect(levelForDistance(CFG.nearDistance + 0.5, 'NEAR', CFG)).toBe('NEAR')
    expect(levelForDistance(CFG.nearDistance - 0.5, 'DORMANT', CFG)).toBe('DORMANT')
  })

  it('runs each level at its rate (not 60 Hz), critical zombies every tick, and hands over all elapsed time', () => {
    const zombies = zombiesAt([3, 15, 40, 90])
    const s = new AIScheduler(CFG)
    for (const z of zombies.values()) s.add(z, PLAYER)
    const tally = run(s, zombies, 10)
    const [critical, active, near, dormant] = ['zombie-1', 'zombie-2', 'zombie-3', 'zombie-4'].map((id) => tally.get(id)!)
    expect(critical.runs).toBe(600)
    expect(active.runs).toBeGreaterThanOrEqual(CFG.activeAiHz * 10 - 1)
    expect(active.runs).toBeLessThanOrEqual(CFG.activeAiHz * 10 + 1)
    expect(near.runs).toBeGreaterThanOrEqual(CFG.nearAiHz * 10 - 1)
    expect(near.runs).toBeLessThanOrEqual(CFG.nearAiHz * 10 + 1)
    expect(dormant.runs).toBeGreaterThanOrEqual(Math.floor(CFG.dormantAiHz * 10) - 1)
    expect(dormant.runs).toBeLessThanOrEqual(Math.ceil(CFG.dormantAiHz * 10) + 1)
    // Simulated time is conserved (up to the not-yet-run remainder).
    for (const e of [critical, active, near]) expect(e.time).toBeGreaterThan(9.5)
    expect(dormant.time).toBeGreaterThan(10 - 1 / CFG.dormantAiHz - 0.01)
  })

  it('a zombie winding up an attack, staggered or knocked back is critical wherever it is', () => {
    const zombies = zombiesAt([15])
    const z = zombies.get('zombie-1')!
    const s = new AIScheduler(CFG)
    s.add(z, PLAYER)
    expect(s.isCritical(z, PLAYER)).toBe(false)
    z.attackWindup = 0.2
    expect(s.isCritical(z, PLAYER)).toBe(true)
    z.attackWindup = -1
    z.knockback.x = 1
    expect(s.isCritical(z, PLAYER)).toBe(true)
    z.knockback.x = 0
    z.ai = 'DEAD'
    expect(s.isCritical(z, PLAYER)).toBe(true)
  })

  it('caps scheduled updates per tick (most overdue first) and never starves anyone', () => {
    const zombies = zombiesAt(Array.from({ length: 200 }, (_, i) => 10 + (i % 10)))
    const s = new AIScheduler({ ...CFG, maxAiUpdatesPerTick: 20 })
    for (const z of zombies.values()) s.add(z, PLAYER)
    const out: ScheduledUpdate[] = []
    let max = 0
    const seen = new Set<string>()
    for (let i = 0; i < 120; i++) {
      s.plan(zombies, PLAYER, 1 / 60, out)
      max = Math.max(max, out.length)
      for (const u of out) seen.add(u.zombie.id)
    }
    expect(max).toBeLessThanOrEqual(20)
    expect(seen.size).toBe(200)
  })

  it('moving closer upgrades the level at once and reports the change', () => {
    const zombies = zombiesAt([90])
    const z = zombies.get('zombie-1')!
    const s = new AIScheduler(CFG)
    s.add(z, PLAYER)
    expect(z.simLevel).toBe('DORMANT')
    z.position.x = 10
    const changes: string[] = []
    s.updateLevels(zombies.values(), PLAYER, 1, (zz, from) => changes.push(`${from}->${zz.simLevel}`), true)
    expect(changes).toEqual(['DORMANT->ACTIVE'])
    // Due within one ACTIVE interval (its slot was pulled in from the DORMANT schedule), with all the
    // time since its last update.
    const out: ScheduledUpdate[] = []
    let ran: ScheduledUpdate | undefined
    for (let t = 0; t <= 1 / CFG.activeAiHz + 1e-9 && !ran; t += 1 / 60) ran = s.plan(zombies, PLAYER, 1 / 60, out)[0]
    expect(ran?.zombie.id).toBe('zombie-1')
    expect(ran!.dt).toBeGreaterThan(0)
  })
})
