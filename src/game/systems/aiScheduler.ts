import type { GAME_CONFIG } from '../core/config'
import type { SimLevel, ZombieState } from '../entities/zombie'
import type { EntityId, Vec3 } from '../../types'

type SimulationCfg = typeof GAME_CONFIG.simulation

/**
 * R2 AI scheduler: decides which zombies run their AI (`stepZombie`) this tick and with which time
 * step. Zombies do not keep their own timers: the scheduler owns one slot per zombie (last update,
 * next due time) and a clock.
 *
 * - Levels (ACTIVE / NEAR / DORMANT) come from the distance to the player, re-evaluated every
 *   `levelInterval` with a hysteresis band.
 * - Critical zombies (close to the player, winding up an attack, staggered, knocked back, or dead and
 *   ACTIVE for the fall animation) update every tick: combat timing is unchanged.
 * - Others update at their level's rate, phase-shifted by ID so they spread over ticks, at most
 *   `maxAiUpdatesPerTick` per tick (most overdue first). An update receives all the time since the
 *   zombie's previous one (capped), so timers, memory and cooldowns stay correct.
 */

export interface ScheduledUpdate {
  zombie: ZombieState
  dt: number
}

interface Slot {
  last: number
  next: number
}

/** Deterministic 0..1 phase from an ID (FNV-1a). */
function phaseOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

function planar(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

/** Level for a distance; `current` applies the hysteresis band (null = no band, first placement). */
export function levelForDistance(d: number, current: SimLevel | null, cfg: SimulationCfg): SimLevel {
  const h = current ? cfg.levelHysteresis / 2 : 0
  const activeEdge = current === 'ACTIVE' ? cfg.activeDistance + h : cfg.activeDistance - h
  if (d <= activeEdge) return 'ACTIVE'
  const nearEdge = current === 'DORMANT' ? cfg.nearDistance - h : cfg.nearDistance + h
  return d <= nearEdge ? 'NEAR' : 'DORMANT'
}

export class AIScheduler {
  private readonly cfg: SimulationCfg
  private time = 0
  private levelTimer = 0
  private readonly slots = new Map<EntityId, Slot>()
  private readonly due: ZombieState[] = []
  private readonly runSet = new Set<ZombieState>()
  /** Updates run last tick by kind (instrumentation). */
  readonly stats = { critical: 0, scheduled: 0, deferred: 0 }

  constructor(cfg: SimulationCfg) {
    this.cfg = cfg
  }

  interval(level: SimLevel): number {
    const hz = level === 'ACTIVE' ? this.cfg.activeAiHz : level === 'NEAR' ? this.cfg.nearAiHz : this.cfg.dormantAiHz
    return 1 / hz
  }

  /** Register a zombie (spawn/load): level from its distance, first update spread by its ID. */
  add(zombie: ZombieState, player: Vec3): void {
    zombie.simLevel = levelForDistance(planar(zombie.position, player), null, this.cfg)
    this.slots.set(zombie.id, { last: this.time, next: this.time + this.interval(zombie.simLevel) * phaseOf(zombie.id) })
  }

  remove(id: EntityId): void {
    this.slots.delete(id)
  }

  clear(): void {
    this.slots.clear()
    this.time = 0
    this.levelTimer = 0
  }

  /**
   * Re-evaluate levels when due (or `force`); calls `onChange` for every zombie whose level changed.
   * A zombie moving to a faster rate is due at once.
   */
  updateLevels(zombies: Iterable<ZombieState>, player: Vec3, dt: number, onChange: (z: ZombieState, from: SimLevel) => void, force = false): void {
    this.levelTimer -= dt
    if (!force && this.levelTimer > 0) return
    this.levelTimer = this.cfg.levelInterval
    for (const z of zombies) {
      const level = levelForDistance(planar(z.position, player), z.simLevel, this.cfg)
      if (level === z.simLevel) continue
      const from = z.simLevel
      z.simLevel = level
      const slot = this.slots.get(z.id)
      if (slot) slot.next = Math.min(slot.next, slot.last + this.interval(level))
      onChange(z, from)
    }
  }

  isCritical(z: ZombieState, player: Vec3): boolean {
    if (z.simLevel !== 'ACTIVE') return false
    if (z.ai === 'DEAD') return true
    if (z.attackWindup >= 0 || z.staggerTimer > 0 || z.knockback.x !== 0 || z.knockback.z !== 0) return true
    return planar(z.position, player) <= this.cfg.criticalDistance
  }

  /**
   * Advance the scheduler clock by `dt` and list this tick's AI updates in map order (the order of
   * the zombie map, so attacks and door hits keep their old order).
   */
  plan(zombies: Map<EntityId, ZombieState>, player: Vec3, dt: number, out: ScheduledUpdate[]): ScheduledUpdate[] {
    this.time += dt
    const t = this.time
    const due = this.due
    const run = this.runSet
    due.length = 0
    run.clear()
    let critical = 0
    for (const z of zombies.values()) {
      const slot = this.slots.get(z.id)
      if (!slot) continue
      if (this.isCritical(z, player)) {
        run.add(z)
        critical += 1
      } else if (t >= slot.next) {
        due.push(z)
      }
    }
    // Over budget: the most overdue first; the rest stay due for the next tick.
    let deferred = 0
    if (due.length > this.cfg.maxAiUpdatesPerTick) {
      due.sort((a, b) => this.slots.get(a.id)!.next - this.slots.get(b.id)!.next)
      deferred = due.length - this.cfg.maxAiUpdatesPerTick
      due.length = this.cfg.maxAiUpdatesPerTick
    }
    for (const z of due) run.add(z)
    out.length = 0
    for (const z of zombies.values()) {
      if (!run.has(z)) continue
      const slot = this.slots.get(z.id)!
      const cap = z.simLevel === 'DORMANT' ? this.cfg.dormantMaxAiDt : this.cfg.maxAiDt
      out.push({ zombie: z, dt: Math.min(t - slot.last, cap) })
      slot.last = t
      const interval = this.interval(z.simLevel)
      // Keep the phase: the next slot on this zombie's grid after now.
      slot.next = slot.next + interval * Math.max(1, Math.ceil((t - slot.next) / interval + 1e-9))
      if (slot.next <= t) slot.next = t + interval
    }
    this.stats.critical = critical
    this.stats.scheduled = out.length - critical
    this.stats.deferred = deferred
    return out
  }

  /** Level counts (perf gauges). */
  countLevels(zombies: Iterable<ZombieState>): Record<SimLevel, number> {
    const n: Record<SimLevel, number> = { ACTIVE: 0, NEAR: 0, DORMANT: 0 }
    for (const z of zombies) if (z.ai !== 'DEAD') n[z.simLevel] += 1
    return n
  }
}
