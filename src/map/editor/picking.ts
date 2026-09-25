import type { Rect, XZ } from '../schema.ts'
import { quantize } from '../transform.ts'
import type { ResolvedRecord } from '../resolve.ts'

/** Spawns are points: they are picked within this radius (metres). */
export const POINT_PICK_RADIUS = 0.6
/**
 * Zones cover whole yards, so they are picked only near their outline or centre (M4); a click or a
 * box-select start inside a zone reaches what stands in it.
 */
export const ZONE_EDGE_PICK = 0.75
export const ZONE_CENTER_PICK = 1

function area(r: Rect): number {
  return (r.maxX - r.minX) * (r.maxZ - r.minZ)
}

function pickRect(r: ResolvedRecord): Rect {
  if (r.category !== 'spawns') return r.bounds
  const d = POINT_PICK_RADIUS
  return { minX: r.bounds.minX - d, minZ: r.bounds.minZ - d, maxX: r.bounds.maxX + d, maxZ: r.bounds.maxZ + d }
}

/** Whether a point hits a zone's outline band or centre marker. */
function hitsZone(r: ResolvedRecord, p: XZ): boolean {
  const zone = r.parts.zones?.[0]
  if (!zone) return false
  const dx = p.x - zone.center.x
  const dz = p.z - zone.center.z
  if (Math.hypot(dx, dz) <= ZONE_CENTER_PICK) return true
  if (zone.halfSize) {
    const ax = Math.abs(dx)
    const az = Math.abs(dz)
    const { x: hx, z: hz } = zone.halfSize
    if (ax > hx + ZONE_EDGE_PICK || az > hz + ZONE_EDGE_PICK) return false
    return Math.abs(ax - hx) <= ZONE_EDGE_PICK || Math.abs(az - hz) <= ZONE_EDGE_PICK
  }
  return Math.abs(Math.hypot(dx, dz) - zone.radius) <= ZONE_EDGE_PICK
}

/**
 * Record under a ground point: the one with the smallest footprint containing it, so a crate in a
 * yard wins over the road under it, and a spawn wins over the building it stands in. Zones only
 * count near their outline/centre. Ties keep content order. `ignore` skips hidden/locked records.
 */
export function pickRecord(records: readonly ResolvedRecord[], p: XZ, ignore?: (r: ResolvedRecord) => boolean): ResolvedRecord | null {
  let best: ResolvedRecord | null = null
  let bestArea = Infinity
  for (const r of records) {
    if (ignore?.(r)) continue
    const b = pickRect(r)
    if (p.x < b.minX - ZONE_EDGE_PICK || p.x > b.maxX + ZONE_EDGE_PICK || p.z < b.minZ - ZONE_EDGE_PICK || p.z > b.maxZ + ZONE_EDGE_PICK) continue
    if (r.category === 'zones' ? !hitsZone(r, p) : p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ) continue
    const a = area(b)
    if (a < bestArea) {
      best = r
      bestArea = a
    }
  }
  return best
}

/** Box select (M4): records whose footprint (a spawn: its point) lies entirely inside `rect`. */
export function recordsInRect(records: readonly ResolvedRecord[], rect: Rect, ignore?: (r: ResolvedRecord) => boolean): ResolvedRecord[] {
  const r = { minX: Math.min(rect.minX, rect.maxX), minZ: Math.min(rect.minZ, rect.maxZ), maxX: Math.max(rect.minX, rect.maxX), maxZ: Math.max(rect.minZ, rect.maxZ) }
  return records.filter((x) => !ignore?.(x) && x.bounds.minX >= r.minX && x.bounds.maxX <= r.maxX && x.bounds.minZ >= r.minZ && x.bounds.maxZ <= r.maxZ)
}

/** Round a value to the snap step (0 = off). */
export function snap(v: number, step: number): number {
  if (!step) return v
  return quantize(Math.round(v / step) * step)
}
