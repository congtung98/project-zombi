import type { Rect, XZ } from '../schema.ts'
import { quantize } from '../transform.ts'
import type { ResolvedRecord } from '../resolve.ts'

/** Spawns are points: they are picked within this radius (metres). */
export const POINT_PICK_RADIUS = 0.6

function area(r: Rect): number {
  return (r.maxX - r.minX) * (r.maxZ - r.minZ)
}

function pickRect(r: ResolvedRecord): Rect {
  if (r.category !== 'spawns') return r.bounds
  const d = POINT_PICK_RADIUS
  return { minX: r.bounds.minX - d, minZ: r.bounds.minZ - d, maxX: r.bounds.maxX + d, maxZ: r.bounds.maxZ + d }
}

/**
 * Record under a ground point: the one with the smallest footprint containing it, so a crate in a
 * yard wins over the zone or road under it, and a spawn wins over the building it stands in.
 * Ties keep content order. `ignore` skips hidden/locked records.
 */
export function pickRecord(records: readonly ResolvedRecord[], p: XZ, ignore?: (r: ResolvedRecord) => boolean): ResolvedRecord | null {
  let best: ResolvedRecord | null = null
  let bestArea = Infinity
  for (const r of records) {
    if (ignore?.(r)) continue
    const b = pickRect(r)
    if (p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ) continue
    const a = area(b)
    if (a < bestArea) {
      best = r
      bestArea = a
    }
  }
  return best
}

/** Round a value to the snap step (0 = off). */
export function snap(v: number, step: number): number {
  if (!step) return v
  return quantize(Math.round(v / step) * step)
}
