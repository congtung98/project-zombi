import type { ZoneDef } from './mapData.ts'

/**
 * Zone membership (P2-S5 horde zones, rectangles since map editor M4). Pure and free of runtime
 * imports so the map validator (Node CLI) applies the same rule as the game.
 *
 * Rule: a point inside one or more rectangle zones belongs to the smallest of them (ties: map
 * order); otherwise to the zone whose centre is nearest (the S5 rule, unchanged for circle-only
 * maps such as the neighbourhood).
 */

export function isRectZone(zone: ZoneDef): zone is ZoneDef & { halfSize: { x: number; z: number } } {
  return zone.halfSize !== undefined
}

/** Whether a ground point lies in the zone's area (circle or rectangle, edges included). */
export function zoneContains(zone: ZoneDef, x: number, z: number): boolean {
  const dx = x - zone.center.x
  const dz = z - zone.center.z
  if (isRectZone(zone)) return Math.abs(dx) <= zone.halfSize.x && Math.abs(dz) <= zone.halfSize.z
  return dx * dx + dz * dz <= zone.radius * zone.radius
}

export function zoneFor(p: { x: number; z: number }, zones: readonly ZoneDef[] | undefined): ZoneDef | null {
  if (!zones || zones.length === 0) return null
  let rect: ZoneDef | null = null
  let rectArea = Infinity
  for (const zone of zones) {
    if (!isRectZone(zone) || !zoneContains(zone, p.x, p.z)) continue
    const area = zone.halfSize.x * zone.halfSize.z
    if (area < rectArea) {
      rect = zone
      rectArea = area
    }
  }
  if (rect) return rect
  let best: ZoneDef | null = null
  let bestD = Infinity
  for (const zone of zones) {
    const d = Math.hypot(zone.center.x - p.x, zone.center.z - p.z)
    if (d < bestD) {
      best = zone
      bestD = d
    }
  }
  return best
}
