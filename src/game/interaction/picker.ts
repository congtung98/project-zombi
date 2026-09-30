import type { Vec3 } from '../../types'

/**
 * AX4 (WIS §6, docs/character-action-ax0.md §4): what the cursor points at. The camera ray is tested
 * against pick volumes (boxes around interactive objects and zombies), not against every mesh; the
 * nearest hit along the ray wins, so nothing is picked through an object in front of it. Within a
 * short distance of the nearest hit an interactive object is preferred over a character (the owner's
 * priority: object > character > ground). No hit: the ground under the cursor. Picking only chooses a
 * target: whether the player can reach it is checked when the action runs.
 */
export interface Ray {
  origin: Vec3
  /** Unit direction. */
  dir: Vec3
}

export interface PickVolume {
  min: Vec3
  max: Vec3
}

export interface PickCandidate {
  kind: 'object' | 'character'
  id: string
  box: PickVolume
}

export type PickResult =
  | { kind: 'object' | 'character'; id: string; point: Vec3 }
  | { kind: 'ground'; point: Vec3 }

/** Hits this close behind the nearest one (m along the ray) still compete by priority. */
export const PICK_TIE = 0.25

/** Distance along the ray to where it enters the box (0 when it starts inside), or null. */
export function rayBox(ray: Ray, box: PickVolume): number | null {
  let near = 0
  let far = Infinity
  for (const axis of ['x', 'y', 'z'] as const) {
    const o = ray.origin[axis]
    const d = ray.dir[axis]
    const lo = box.min[axis]
    const hi = box.max[axis]
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null
      continue
    }
    let t1 = (lo - o) / d
    let t2 = (hi - o) / d
    if (t1 > t2) [t1, t2] = [t2, t1]
    near = Math.max(near, t1)
    far = Math.min(far, t2)
    if (near > far) return null
  }
  return near
}

/** Where the ray meets the horizontal plane at `y` (in front of the camera), or null. */
export function rayPlane(ray: Ray, y: number): Vec3 | null {
  if (Math.abs(ray.dir.y) < 1e-9) return null
  const t = (y - ray.origin.y) / ray.dir.y
  if (t < 0) return null
  return { x: ray.origin.x + ray.dir.x * t, y, z: ray.origin.z + ray.dir.z * t }
}

export function pick(ray: Ray, candidates: readonly PickCandidate[], groundY: number): PickResult | null {
  let nearest = Infinity
  const hits: { c: PickCandidate; t: number }[] = []
  for (const c of candidates) {
    const t = rayBox(ray, c.box)
    if (t === null) continue
    hits.push({ c, t })
    if (t < nearest) nearest = t
  }
  if (hits.length > 0) {
    let best: { c: PickCandidate; t: number } | null = null
    for (const h of hits) {
      if (h.t > nearest + PICK_TIE) continue
      if (!best || rank(h.c) < rank(best.c) || (rank(h.c) === rank(best.c) && h.t < best.t)) best = h
    }
    const { c, t } = best!
    return { kind: c.kind, id: c.id, point: { x: ray.origin.x + ray.dir.x * t, y: ray.origin.y + ray.dir.y * t, z: ray.origin.z + ray.dir.z * t } }
  }
  const ground = rayPlane(ray, groundY)
  return ground ? { kind: 'ground', point: ground } : null
}

const rank = (c: PickCandidate) => (c.kind === 'object' ? 0 : 1)

/** Box of half extents around a centre. */
export function boxAround(center: Vec3, hx: number, hy: number, hz: number): PickVolume {
  return { min: { x: center.x - hx, y: center.y - hy, z: center.z - hz }, max: { x: center.x + hx, y: center.y + hy, z: center.z + hz } }
}
