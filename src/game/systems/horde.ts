import { GAME_CONFIG } from '../core/config'
import { UNAWARE_STATES } from '../entities/zombie'
import type { ZoneDef } from '../world/mapData'
import { zoneFor } from '../world/zones'
import type { Rng } from './loot'
import type { EntityId, Vec3, ZombieAIState } from '../../types'

/**
 * Zone a zombie at `p` belongs to: the smallest rectangle zone containing it, else the zone whose
 * centre is nearest (`world/zones.ts`); null when the map has no zones.
 */
export function nearestZone(p: Vec3, zones: readonly ZoneDef[] | undefined): ZoneDef | null {
  return zoneFor(p, zones)
}

export interface HordeMember {
  id: EntityId
  zoneId: string | null
  ai: ZombieAIState
}

export interface MigrationPlan {
  from: string
  to: string
  /** Every living member of the source zone, hunters included (they keep hunting for now). */
  ids: EntityId[]
}

/**
 * The external migration director (P2-S5): choose one group (the zombies of a zone with at least
 * `minGroupSize` idle/wandering members) and another zone to move it to, preferring emptier zones
 * (weight 1 / (1 + zombies there)) so groups spread instead of all piling up in one place. Pure:
 * randomness only from `rng`, so a seed and counter reproduce it. null = no group big enough.
 */
export function planMigration(members: readonly HordeMember[], zones: readonly ZoneDef[], rng: Rng, cfg = GAME_CONFIG.horde): MigrationPlan | null {
  if (zones.length < 2) return null
  const population = new Map<string, number>(zones.map((z) => [z.id, 0]))
  const calm = new Map<string, number>()
  for (const m of members) {
    if (m.ai === 'DEAD' || m.zoneId === null || !population.has(m.zoneId)) continue
    population.set(m.zoneId, population.get(m.zoneId)! + 1)
    // Zombies already migrating do not count as a group ready to leave again.
    if (UNAWARE_STATES.has(m.ai) && m.ai !== 'MIGRATE') calm.set(m.zoneId, (calm.get(m.zoneId) ?? 0) + 1)
  }
  const sources = zones.filter((z) => (calm.get(z.id) ?? 0) >= cfg.minGroupSize)
  if (sources.length === 0) return null
  const from = sources[Math.floor(rng() * sources.length)]
  const targets = zones.filter((z) => z.id !== from.id)
  const weights = targets.map((z) => 1 / (1 + population.get(z.id)!))
  let roll = rng() * weights.reduce((a, b) => a + b, 0)
  let to = targets[targets.length - 1]
  for (let i = 0; i < targets.length; i++) {
    roll -= weights[i]
    if (roll <= 0) {
      to = targets[i]
      break
    }
  }
  const ids = members.filter((m) => m.ai !== 'DEAD' && m.zoneId === from.id).map((m) => m.id)
  return { from: from.id, to: to.id, ids }
}

/** Time until the next migration attempt, in [intervalMin, intervalMax]. */
export function migrationInterval(rng: Rng, cfg = GAME_CONFIG.horde): number {
  return cfg.intervalMin + (cfg.intervalMax - cfg.intervalMin) * rng()
}
