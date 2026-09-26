import type { Rect } from '../../map/schema.ts'

/**
 * M11b multi-storey buildings: upper floor slabs and stairs in world space, and the one rule that
 * gives every body its height (`FloorField.surfaceAt`). Pure (no Three.js/Rapier), shared by the
 * resolver, the simulation and the Node CLI (explicit `.ts` imports).
 *
 * Heights are feet elevations: 0 is the ground, storey k of a building stands at k·storeyHeight.
 * A body keeps the highest walkable surface under it that is at most `STEP_UP` above its feet, so
 * it walks up a ramp, stays on a slab, walks off the top of a flight onto the slab, and never
 * climbs onto a slab from below (slabs are a whole storey above the floor under them).
 */

/** Slab thickness (m); its top is the storey's floor. */
export const SLAB_THICKNESS = 0.2
/** Height of the railings around a stairwell on the upper storey. */
export const STAIR_RAIL = 1
/**
 * Highest surface a body steps up to between two updates. Large enough for a long frame on the
 * steepest allowed flight (slope ≤ 1, ≤ 0.7 m per 0.1 s tick when running), far below a storey.
 */
export const STEP_UP = 1
/** Points closer than this vertically are on the same floor (sight, reach, interaction, pushing). */
export const LEVEL_TOLERANCE = 1.2

/** Upper floor slab piece: `rect` at height `y` (its top), for storey `level` ≥ 1 of `buildingId`. */
export interface FloorSlab {
  id: string
  buildingId: string
  level: number
  y: number
  rect: Rect
}

/** A straight flight between two storeys of a building, in world space. */
export interface StairPlacement {
  id: string
  buildingId: string
  /** Lower storey; the flight arrives at `level + 1`. */
  level: number
  /** Walked rectangle (the stairwell hole in the upper slab). */
  rect: Rect
  /** Axis the flight climbs along and which way (+1 = towards +axis). */
  axis: 'x' | 'z'
  dir: 1 | -1
  /** Floor heights at the bottom and top ends. */
  bottomY: number
  topY: number
  width: number
  length: number
}

/** Centre of the bottom (`end` 0) or top (`end` 1) edge of a flight, at that end's floor height. */
export function stairEnd(s: StairPlacement, end: 0 | 1): { x: number; y: number; z: number } {
  const cx = (s.rect.minX + s.rect.maxX) / 2
  const cz = (s.rect.minZ + s.rect.maxZ) / 2
  const sign = (end === 0 ? -1 : 1) * s.dir
  const y = end === 0 ? s.bottomY : s.topY
  return s.axis === 'x' ? { x: cx + (sign * s.length) / 2, y, z: cz } : { x: cx, y, z: cz + (sign * s.length) / 2 }
}

/** Point `distance` beyond an end of the flight, on its centre line (outside the stairwell). */
export function stairApproach(s: StairPlacement, end: 0 | 1, distance: number): { x: number; y: number; z: number } {
  const p = stairEnd(s, end)
  const sign = (end === 0 ? -1 : 1) * s.dir
  if (s.axis === 'x') p.x += sign * distance
  else p.z += sign * distance
  return p
}

/** 0 at the bottom edge, 1 at the top edge (clamped), for a point over the flight. */
export function stairProgress(s: StairPlacement, x: number, z: number): number {
  const along = s.axis === 'x' ? x : z
  const lo = s.axis === 'x' ? s.rect.minX : s.rect.minZ
  const t = (along - lo) / s.length
  return Math.min(1, Math.max(0, s.dir > 0 ? t : 1 - t))
}

export function stairHeightAt(s: StairPlacement, x: number, z: number): number {
  return s.bottomY + (s.topY - s.bottomY) * stairProgress(s, x, z)
}

export function inRect(r: Rect, x: number, z: number, margin = 0): boolean {
  return x >= r.minX - margin && x <= r.maxX + margin && z >= r.minZ - margin && z <= r.maxZ + margin
}

/** `a` minus `b`: up to four rectangles (strips), none when `b` covers `a`. */
export function subtractRect(a: Rect, b: Rect): Rect[] {
  const minX = Math.max(a.minX, b.minX)
  const maxX = Math.min(a.maxX, b.maxX)
  const minZ = Math.max(a.minZ, b.minZ)
  const maxZ = Math.min(a.maxZ, b.maxZ)
  if (minX >= maxX || minZ >= maxZ) return [{ ...a }]
  const out: Rect[] = []
  if (a.minZ < minZ) out.push({ minX: a.minX, minZ: a.minZ, maxX: a.maxX, maxZ: minZ })
  if (maxZ < a.maxZ) out.push({ minX: a.minX, minZ: maxZ, maxX: a.maxX, maxZ: a.maxZ })
  if (a.minX < minX) out.push({ minX: a.minX, minZ, maxX: minX, maxZ })
  if (maxX < a.maxX) out.push({ minX: maxX, minZ, maxX: a.maxX, maxZ })
  return out
}

/** Rectangles minus holes (every hole cut from every piece), dropping slivers. */
export function subtractRects(pieces: readonly Rect[], holes: readonly Rect[]): Rect[] {
  let out = pieces.map((r) => ({ ...r }))
  for (const h of holes) out = out.flatMap((r) => subtractRect(r, h))
  return out.filter((r) => r.maxX - r.minX > 1e-6 && r.maxZ - r.minZ > 1e-6)
}

/** Grid cell (m) of the floor index: a building is a few cells. */
const CELL = 8

/**
 * Walkable surfaces of a map: the ground (y = 0 everywhere), slabs and stairs. A map without upper
 * floors answers 0 at once, so single-storey worlds pay nothing.
 */
/** Longest stretch `FloorField.follow` checks at once (m). */
const FOLLOW_STEP = 0.25
/** A move longer than this in one step is a teleport (scripts, load), not a walk (m). */
const TELEPORT_DISTANCE = 4

export class FloorField {
  readonly slabs: readonly FloorSlab[]
  readonly stairs: readonly StairPlacement[]
  private readonly cells = new Map<string, { slabs: FloorSlab[]; stairs: StairPlacement[] }>()

  constructor(slabs: readonly FloorSlab[] = [], stairs: readonly StairPlacement[] = []) {
    this.slabs = slabs
    this.stairs = stairs
    for (const s of slabs) this.index(s.rect, (c) => c.slabs.push(s))
    for (const s of stairs) this.index(s.rect, (c) => c.stairs.push(s))
  }

  get flat(): boolean {
    return this.slabs.length === 0 && this.stairs.length === 0
  }

  private index(r: Rect, add: (cell: { slabs: FloorSlab[]; stairs: StairPlacement[] }) => void): void {
    for (let cz = Math.floor(r.minZ / CELL); cz <= Math.floor(r.maxZ / CELL); cz++) {
      for (let cx = Math.floor(r.minX / CELL); cx <= Math.floor(r.maxX / CELL); cx++) {
        const key = `${cx},${cz}`
        let cell = this.cells.get(key)
        if (!cell) this.cells.set(key, (cell = { slabs: [], stairs: [] }))
        add(cell)
      }
    }
  }

  /** Height of the surface a body with feet at `feetY` stands on at (x, z). */
  surfaceAt(x: number, z: number, feetY: number): number {
    if (this.flat) return 0
    const cell = this.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`)
    if (!cell) return 0
    const limit = feetY + STEP_UP
    let best = 0
    for (const s of cell.slabs) if (s.y <= limit && s.y > best && inRect(s.rect, x, z)) best = s.y
    for (const s of cell.stairs) {
      if (!inRect(s.rect, x, z)) continue
      const y = stairHeightAt(s, x, z)
      if (y <= limit && y > best) best = y
    }
    return best
  }

  /**
   * M11c-1B: the surface after moving from (fromX, fromZ) to (toX, toZ) with feet at `feetY`,
   * applying the step-up rule every `FOLLOW_STEP` along the way. A body that moves far in one step
   * (a slow frame: the physics moved it more than a metre) still climbs a flight instead of passing
   * under it. A move longer than `TELEPORT_DISTANCE` is a teleport: the destination alone decides.
   */
  follow(fromX: number, fromZ: number, toX: number, toZ: number, feetY: number): number {
    if (this.flat) return 0
    const len = Math.hypot(toX - fromX, toZ - fromZ)
    if (len > TELEPORT_DISTANCE) return this.surfaceAt(toX, toZ, feetY)
    const steps = Math.max(1, Math.ceil(len / FOLLOW_STEP))
    let y = feetY
    for (let i = 1; i <= steps; i++) y = this.surfaceAt(fromX + ((toX - fromX) * i) / steps, fromZ + ((toZ - fromZ) * i) / steps, y)
    return y
  }

  /** Flights whose index cell holds the point (a coarse filter). */
  stairsNear(x: number, z: number): readonly StairPlacement[] {
    if (this.stairs.length === 0) return []
    return this.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`)?.stairs ?? []
  }

  /** The flight a point is on (inside its rectangle, between its floors), or null. */
  stairAt(x: number, z: number, y: number, margin = 0): StairPlacement | null {
    if (this.stairs.length === 0) return null
    const cell = this.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`)
    for (const s of cell?.stairs ?? []) {
      if (inRect(s.rect, x, z, margin) && y >= s.bottomY - 0.5 && y <= s.topY + 0.5) return s
    }
    return null
  }
}
