import type { PrefabDocument, QuarterTurns, Rect, XZ } from '../schema.ts'
import { quantize, rotateXZ } from '../transform.ts'
import { hashSeed, parcelRect, rng } from './parcels.ts'
import { RectIndex, rectsOverlap } from './rects.ts'
import type { EnvironmentParams, LayoutParcel, LayoutPlan, ParcelBuild, Side, StreetSurface } from './schema.ts'

/**
 * EnvironmentGenerator (world generator WG5, `docs/writing-block.md` §13): the details that make a
 * generated town look lived in and abandoned, as the map objects the game and the editor already
 * have (no new object kind):
 *
 * - trees (M9 `tree`: trunk collider, drawn canopy) along lot fronts, in back yards, dense on forest
 *   land, scattered on empty land; bushes and grass tufts (G3b/G4 `decor`, drawn only);
 * - back fences of residential lots (`prop` wearing `outdoor/fence`), wheelie bins (`container`,
 *   scrap loot, `outdoor/bin`) and mailboxes (`prop`, `outdoor/mailbox`, at the prefab's `mailbox`
 *   anchor when it has one);
 * - streetlights on the sidewalks (`prop` wearing `outdoor/streetlight`: a decorative post, Q8);
 * - parked cars (`prop`, `outdoor/car`) and abandoned ones (`container` with scrap loot) along the
 *   kerb of wide streets, with tyres and oil stains; litter (papers, cans) on sidewalks and yards.
 *
 * Rules (checked by `checkEnvironment` and the deep check): nothing with a collider on a building's
 * footprint (plus a margin), in front of any of its ground-floor doors or on the path from its
 * entrance to the street; cars only on carriageways at least 6 m wide, at the kerb, never near a
 * junction, so at least a 3.5 m lane stays clear; fences only along the rear line of a lot, open at
 * both ends (never a closed pen); nothing on water, railways or no-build land (the parcels already
 * avoid them). Deterministic: each lot and street piece has its own seeded stream, so changing one
 * lot's building changes only that lot's details.
 *
 * Items are named `env-<parcel>-<kind>-<n>` (lot details, owned by the parcel: they follow it through
 * selective regeneration and locks) or `street-<surface>-<kind>-<n>`.
 */

export const DEFAULT_ENVIRONMENT: EnvironmentParams = { density: 0.6, trees: true, planting: true, fences: true, streetFurniture: true, streetlights: true, vehicles: true, litter: true }

export const ENVIRONMENT_KINDS = ['trees', 'planting', 'fences', 'streetFurniture', 'streetlights', 'vehicles', 'litter'] as const

export type EnvItem =
  | { name: string; kind: 'tree'; at: XZ; height: number; canopy: number; trunk: number; color: string; style: 'round' | 'pine' }
  | { name: string; kind: 'decor'; at: XZ; assetId: string; yaw: number }
  | { name: string; kind: 'prop' | 'container'; at: XZ; size: [number, number, number]; color: string; assetId: string; facing?: QuarterTurns; label?: string; loot?: string }

/** Placed building: its prefab and where the generator put it. */
export interface PlacedPrefab {
  doc: PrefabDocument
  build: Extract<ParcelBuild, { prefabId: string }>
}

const TREE_COLORS = ['#3f6b35', '#4a7a3a', '#35602f', '#5b7f3a']
const PINE_COLORS = ['#2f5a3a', '#28503a', '#355f40']
const CAR_COLORS = ['#7a3b3b', '#3b5a7a', '#5a5a52', '#8a8a86', '#2f3b34']
const WRECK_COLORS = ['#6b5a4a', '#5a4f47', '#4f4a44']
const FENCE_COLORS = ['#7a6a55', '#d8d2c4', '#6b5a44']
const BIN_COLORS = ['#3f5a3f', '#2f3f5a', '#4a4a4a']
/** Clear ground kept around a building (m) and in front of each ground-floor door. */
const FOOTPRINT_MARGIN = 0.8
const DOOR_CLEAR = 1.4
/** Half width of the kept path from an entrance to the street. */
const PATH_HALF = 1.3
/** Street pieces: cars stay this far from any crossing carriageway. */
const JUNCTION_CLEAR = 7
/** Road a parked car always leaves clear (m): one full lane. */
export const ROAD_CLEAR = 3.5
/** Gap between a parked car and the kerb (m). */
const KERB_GAP = 0.15

const q3 = (v: number) => quantize(v)
const rectAt = (c: XZ, w: number, d: number): Rect => ({ minX: c.x - w / 2, minZ: c.z - d / 2, maxX: c.x + w / 2, maxZ: c.z + d / 2 })
const inside = (r: Rect, outer: Rect, pad = 0) => r.minX >= outer.minX + pad && r.maxX <= outer.maxX - pad && r.minZ >= outer.minZ + pad && r.maxZ <= outer.maxZ - pad

/** World position of a prefab point once placed. */
function placedPoint(p: PlacedPrefab, local: XZ): XZ {
  const [x, z] = rotateXZ(local.x - p.doc.pivot.x, local.z - p.doc.pivot.z, p.build.quarterTurns)
  return { x: p.build.position.x + x, z: p.build.position.z + z }
}

/** Ground-floor doors of a placed building (world centres). */
export function doorPoints(p: PlacedPrefab): XZ[] {
  return p.doc.objects.flatMap((o) => (o.kind === 'door' && !o.level ? [placedPoint(p, o.position)] : []))
}

/** The entrance of a placed building: `placement.entrance`, else its first ground-floor door. */
export function entrancePoint(p: PlacedPrefab): XZ | null {
  if (p.doc.placement?.entrance) return placedPoint(p, p.doc.placement.entrance)
  return doorPoints(p)[0] ?? null
}

/** Rectangle from the entrance to the parcel's street edge that must stay clear. */
export function entrancePath(q: LayoutParcel, entrance: XZ): Rect | null {
  if (!q.access) return null
  const r = parcelRect(q)
  switch (q.access.side) {
    case 'N':
      return { minX: entrance.x - PATH_HALF, maxX: entrance.x + PATH_HALF, minZ: r.minZ - 0.5, maxZ: entrance.z + 0.5 }
    case 'S':
      return { minX: entrance.x - PATH_HALF, maxX: entrance.x + PATH_HALF, minZ: entrance.z - 0.5, maxZ: r.maxZ + 0.5 }
    case 'W':
      return { minZ: entrance.z - PATH_HALF, maxZ: entrance.z + PATH_HALF, minX: r.minX - 0.5, maxX: entrance.x + 0.5 }
    case 'E':
      return { minZ: entrance.z - PATH_HALF, maxZ: entrance.z + PATH_HALF, minX: entrance.x - 0.5, maxX: r.maxX + 0.5 }
  }
}

/** Keep-out rectangles of every building of the plan: footprint + margin, door squares, entrance paths. */
export function keepOuts(plan: LayoutPlan, placed: ReadonlyMap<string, PlacedPrefab>): Rect[] {
  const out: Rect[] = []
  for (const q of plan.parcels) {
    const p = placed.get(q.id)
    if (!p) continue
    const f = p.build.footprint
    out.push({ minX: f.minX - FOOTPRINT_MARGIN, minZ: f.minZ - FOOTPRINT_MARGIN, maxX: f.maxX + FOOTPRINT_MARGIN, maxZ: f.maxZ + FOOTPRINT_MARGIN })
    for (const d of doorPoints(p)) out.push(rectAt(d, 2 * DOOR_CLEAR, 2 * DOOR_CLEAR))
    const e = entrancePoint(p)
    const path = e && entrancePath(q, e)
    if (path) out.push(path)
  }
  return out
}

/** Rear side of a lot (opposite its street). */
const REAR: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' }

class Placer {
  readonly items: EnvItem[] = []
  /** Collider rectangles placed so far. */
  private readonly solids = new RectIndex()
  private readonly counts = new Map<string, number>()
  /** Building keep-outs (footprint + margin, door squares, entrance paths) and bare footprints. */
  private readonly keep = new RectIndex()
  private readonly footprints = new RectIndex()
  /** Everything stays this far inside the play area (canopies included). */
  private readonly area: Rect
  constructor(keep: readonly Rect[], footprints: readonly Rect[], area: Rect) {
    this.area = { minX: area.minX + 1, minZ: area.minZ + 1, maxX: area.maxX - 1, maxZ: area.maxZ - 1 }
    for (const r of keep) this.keep.add(r)
    for (const r of footprints) this.footprints.add(r)
  }
  private name(prefix: string, kind: string): string {
    const key = `${prefix}-${kind}`
    const n = (this.counts.get(key) ?? 0) + 1
    this.counts.set(key, n)
    return `${key}-${n}`
  }
  /** `anchored`: at a prefab's own anchor, which only has to clear the bare footprints. */
  free(r: Rect, margin = 0.3, anchored = false): boolean {
    if (!inside(r, this.area)) return false
    const grown = { minX: r.minX - margin, minZ: r.minZ - margin, maxX: r.maxX + margin, maxZ: r.maxZ + margin }
    if ((anchored ? this.footprints : this.keep).overlaps(anchored ? r : grown)) return false
    return !this.solids.overlaps(grown)
  }
  solid(prefix: string, item: Omit<Extract<EnvItem, { kind: 'prop' | 'container' }>, 'name'>, margin = 0.3, anchored = false): boolean {
    const w = item.size[0]
    const d = item.size[2]
    const r = rectAt(item.at, w, d)
    if (!this.free(r, margin, anchored)) return false
    this.solids.add(r)
    this.items.push({ ...item, at: { x: q3(item.at.x), z: q3(item.at.z) }, name: this.name(prefix, item.assetId.split('/')[1]) })
    return true
  }
  tree(prefix: string, at: XZ, style: 'round' | 'pine', scale: number, random: () => number, small = false, canopyClear: readonly Rect[] = []): boolean {
    const canopy = q3(small ? 1.1 + scale * 0.4 : style === 'pine' ? 1.4 + scale * 0.8 : 1.6 + scale * 1.2)
    const height = q3(small ? 4.5 + scale * 1.5 : style === 'pine' ? 6 + scale * 4 : 5 + scale * 3)
    const trunk = small || style === 'pine' ? 0.2 : 0.25
    const t = rectAt(at, 2 * trunk, 2 * trunk)
    if (!this.free(t, 0.6)) return false
    // Canopies stay off roofs (the canopy fades only when it hides the player; a roof would be hidden by it).
    const c = rectAt(at, 2 * canopy, 2 * canopy)
    if (!inside(c, this.area) || canopyClear.some((f) => rectsOverlap(f, c))) return false
    this.solids.add(t)
    const colors = style === 'pine' ? PINE_COLORS : TREE_COLORS
    this.items.push({ name: this.name(prefix, 'tree'), kind: 'tree', at: { x: q3(at.x), z: q3(at.z) }, height, canopy, trunk, color: colors[Math.floor(random() * colors.length)], style })
    return true
  }
  decor(prefix: string, assetId: string, at: XZ, random: () => number): void {
    if (!inside(rectAt(at, 1.2, 1.2), this.area)) return
    this.items.push({ name: this.name(prefix, assetId.split('/')[1]), kind: 'decor', at: { x: q3(at.x), z: q3(at.z) }, assetId, yaw: Math.floor(random() * 36) * 10 })
  }
}

/**
 * Environment of a plan whose buildings are decided. `placed`: the prefab of every built parcel.
 * Returns the items in world coordinates, in a deterministic order.
 */
export function environmentItems(plan: LayoutPlan, placed: ReadonlyMap<string, PlacedPrefab>, params: EnvironmentParams = DEFAULT_ENVIRONMENT): EnvItem[] {
  const density = Math.min(1, Math.max(0, params.density))
  if (density === 0) return []
  const footprints = [...placed.values()].map((p) => p.build.footprint)
  const roofs = footprints.map((f) => ({ minX: f.minX - 0.3, minZ: f.minZ - 0.3, maxX: f.maxX + 0.3, maxZ: f.maxZ + 0.3 }))
  const placer = new Placer(keepOuts(plan, placed), footprints, plan.area)

  // 1. Lots and open land.
  for (const q of plan.parcels) {
    const random = rng(hashSeed(q.seed, 'env'))
    const r = parcelRect(q)
    const pre = `env-${q.id}`
    const p = placed.get(q.id)
    const W = r.maxX - r.minX
    const D = r.maxZ - r.minZ
    if (q.kind !== 'lot' || !q.access) {
      // Open land: forest dense, empty land scattered, farmland and interiors a few.
      const step = q.zone === 'forest' ? 4.5 : q.zone === 'empty' ? 8 : 11
      const chance = (q.zone === 'forest' ? 0.55 : q.zone === 'empty' ? 0.35 : q.zone === 'farmland' ? 0.08 : 0.25) * (0.4 + density)
      for (let z = r.minZ + 3; z <= r.maxZ - 3; z += step)
        for (let x = r.minX + 3; x <= r.maxX - 3; x += step) {
          const at = { x: x + (random() - 0.5) * 2, z: z + (random() - 0.5) * 2 }
          const roll = random()
          if (roll >= chance) continue
          if (params.trees && (q.zone === 'forest' || roll < chance * 0.5)) placer.tree(pre, at, q.zone === 'forest' && random() < 0.5 ? 'pine' : 'round', random(), random, false, roofs)
          else if (params.planting) placer.decor(pre, random() < 0.6 ? 'decor/bush' : 'decor/grass', at, random)
        }
      continue
    }
    const side = q.access.side
    const alongX = side === 'N' || side === 'S'
    /** A point `along` m from the lot's left end (min X or min Z) and `depth` m from its street edge. */
    const at = (along: number, depth: number): XZ => {
      const a = alongX ? r.minX + along : r.minZ + along
      if (side === 'N') return { x: a, z: r.minZ + depth }
      if (side === 'S') return { x: a, z: r.maxZ - depth }
      if (side === 'W') return { x: r.minX + depth, z: a }
      return { x: r.maxX - depth, z: a }
    }
    const front = alongX ? W : D
    const deep = alongX ? D : W
    const entrance = p ? entrancePoint(p) : null
    const entranceAlong = entrance ? (alongX ? entrance.x - r.minX : entrance.z - r.minZ) : front / 2
    const house = q.zone === 'residential'

    // Street trees along the front, clear of the entrance.
    if (params.trees && (house || q.zone === 'public')) {
      for (let a = 2; a <= front - 2; a += 7) {
        if (random() >= density * 0.9) continue
        if (Math.abs(a - entranceAlong) < 3) continue
        placer.tree(pre, at(a + (random() - 0.5), 0.9), 'round', random(), random, true, roofs)
      }
      // A back-yard tree now and then.
      if (deep > 12 && random() < density * 0.7) placer.tree(pre, at(random() < 0.5 ? 2.2 : front - 2.2, deep - 2.4), random() < 0.25 ? 'pine' : 'round', random() * 0.5, random, false, roofs)
    }
    // Bushes by the front of the house and grass in the yards (drawn only: never in the way).
    if (params.planting && p) {
      const f = p.build.footprint
      const frontEdge = side === 'N' ? f.minZ - 0.9 : side === 'S' ? f.maxZ + 0.9 : side === 'W' ? f.minX - 0.9 : f.maxX + 0.9
      const [lo, hi] = alongX ? [f.minX, f.maxX] : [f.minZ, f.maxZ]
      for (const a of [lo + 0.8, hi - 0.8]) {
        if (random() >= density) continue
        const pos = alongX ? { x: a, z: frontEdge } : { x: frontEdge, z: a }
        const onPath = entrance && (alongX ? Math.abs(pos.x - entrance.x) < PATH_HALF + 0.6 : Math.abs(pos.z - entrance.z) < PATH_HALF + 0.6)
        if (!onPath) placer.decor(pre, 'decor/bush', pos, random)
      }
      const tufts = Math.round(density * 3 * random())
      for (let k = 0; k < tufts; k++) placer.decor(pre, 'decor/grass', at(1 + random() * (front - 2), 0.6 + random() * Math.max(0.5, deep - 1.2)), random)
    }
    // A back fence, open at both ends; only with room behind the house and no back door near it.
    if (params.fences && house && front >= 6 && random() < 0.35 + 0.5 * density) {
      const rear = REAR[side]
      const line = at(front / 2, deep - 0.3)
      const size: [number, number, number] = alongX ? [q3(front - 1.2), 1, 0.12] : [0.12, 1, q3(front - 1.2)]
      const behind = p ? (rear === 'S' ? r.maxZ - p.build.footprint.maxZ : rear === 'N' ? p.build.footprint.minZ - r.minZ : rear === 'E' ? r.maxX - p.build.footprint.maxX : p.build.footprint.minX - r.minX) : deep
      const backDoor = p ? doorPoints(p).some((d) => (alongX ? Math.abs(d.z - line.z) : Math.abs(d.x - line.x)) < 3) : false
      if (behind >= 1.8 && !backDoor) placer.solid(pre, { kind: 'prop', at: line, size, color: FENCE_COLORS[Math.floor(random() * FENCE_COLORS.length)], assetId: 'outdoor/fence' }, 0.1)
    }
    // Bin by a front corner, mailbox by the path (at the prefab's anchor when it has one).
    if (params.streetFurniture && p && (house || q.zone === 'commercial')) {
      if (random() < 0.3 + 0.6 * density) {
        const a = entranceAlong < front / 2 ? front - 1 : 1
        placer.solid(pre, { kind: 'container', at: at(a, 1.2), size: [0.6, 1.1, 0.6], color: BIN_COLORS[Math.floor(random() * BIN_COLORS.length)], assetId: 'outdoor/bin', facing: facingTo(side), label: 'Thùng rác', loot: 'scrap-pile' })
      }
      if (house && random() < 0.4 + 0.5 * density) {
        const anchor = p.doc.placement?.anchors?.find((x) => x.name === 'mailbox')
        const spot = anchor ? placedPoint(p, anchor.position) : at(Math.min(front - 0.8, Math.max(0.8, entranceAlong + PATH_HALF + 0.6)), 0.5)
        // An anchor inside the kept clearings (it is the author's choice) still has to clear the footprint and the path.
        placer.solid(pre, { kind: 'prop', at: spot, size: [0.3, 1.2, 0.3], color: '#3d4f66', assetId: 'outdoor/mailbox', facing: facingTo(side) }, 0.05, !!anchor)
      }
    }
    if (params.litter && random() < density * 0.5) placer.decor(pre, random() < 0.5 ? 'decor/papers' : 'decor/cans', at(1 + random() * (front - 2), 0.5 + random() * (deep - 1)), random)
  }

  // 2. Streets.
  const carriage = plan.surfaces.filter((s) => s.kind !== 'sidewalk')
  for (const s of plan.surfaces) {
    const random = rng(hashSeed(plan.params.seed, `env:${s.id}`))
    const pre = `street-${s.id}`
    const r = s.rect
    const alongX = r.maxX - r.minX >= r.maxZ - r.minZ
    const len = alongX ? r.maxX - r.minX : r.maxZ - r.minZ
    const wide = alongX ? r.maxZ - r.minZ : r.maxX - r.minX
    if (s.kind === 'sidewalk') {
      if (params.streetlights && wide >= 1.5 && len >= 10) {
        // Posts at the kerb side, every ~24 m (closer when denser), away from the corners.
        const kerb = kerbSide(s, carriage)
        const step = 30 - 12 * density
        for (let a = 4; a <= len - 4; a += step) {
          const off = kerb === 'min' ? 0.35 : wide - 0.35
          const pos = alongX ? { x: r.minX + a, z: r.minZ + off } : { x: r.minX + off, z: r.minZ + a }
          placer.solid(pre, { kind: 'prop', at: pos, size: [0.3, 4.2, 0.3], color: '#4a4d51', assetId: 'outdoor/streetlight' }, 0.2)
        }
      }
      if (params.litter && random() < density * 0.4) {
        const a = 1 + random() * (len - 2)
        placer.decor(pre, random() < 0.6 ? 'decor/papers' : 'decor/cans', alongX ? { x: r.minX + a, z: r.minZ + wide / 2 } : { x: r.minX + wide / 2, z: r.minZ + a }, random)
      }
      continue
    }
    // Carriageway: cars at the kerb of wide streets (a lane always clear), never near a crossing.
    if (!params.vehicles || s.kind !== 'asphalt' || wide < 6 || len < 2 * JUNCTION_CLEAR + 6) continue
    const crossing = carriage.filter((o) => o !== s && rectsOverlap(o.rect, r))
    for (let a = JUNCTION_CLEAR + 2; a <= len - JUNCTION_CLEAR - 2; a += 9) {
      if (random() >= density * 0.35) continue
      const kerbMin = random() < 0.5
      const off = kerbMin ? 1 + KERB_GAP : wide - 1 - KERB_GAP
      const pos = alongX ? { x: r.minX + a, z: r.minZ + off } : { x: r.minX + off, z: r.minZ + a }
      const box = alongX ? rectAt(pos, 4, 2) : rectAt(pos, 2, 4)
      if (crossing.some((o) => rectsOverlap({ minX: box.minX - JUNCTION_CLEAR, minZ: box.minZ - JUNCTION_CLEAR, maxX: box.maxX + JUNCTION_CLEAR, maxZ: box.maxZ + JUNCTION_CLEAR }, o.rect))) continue
      if (!inside(box, r, 0.05)) continue
      const wreck = random() < 0.4
      const facing: QuarterTurns = alongX ? (random() < 0.5 ? 1 : 3) : random() < 0.5 ? 0 : 2
      const size: [number, number, number] = alongX ? [4, 1.4, 2] : [2, 1.4, 4]
      const ok = wreck
        ? placer.solid(pre, { kind: 'container', at: pos, size, color: WRECK_COLORS[Math.floor(random() * WRECK_COLORS.length)], assetId: 'outdoor/car', facing, label: 'Xe bỏ hoang', loot: 'scrap-pile' }, 0.4)
        : placer.solid(pre, { kind: 'prop', at: pos, size, color: CAR_COLORS[Math.floor(random() * CAR_COLORS.length)], assetId: 'outdoor/car', facing }, 0.4)
      if (ok && params.litter && wreck) {
        placer.decor(pre, 'decor/oil-stain', { x: pos.x + (random() - 0.5), z: pos.z + (random() - 0.5) }, random)
        const t = alongX ? { x: pos.x + (random() < 0.5 ? -2.8 : 2.8), z: pos.z } : { x: pos.x, z: pos.z + (random() < 0.5 ? -2.8 : 2.8) }
        if (inside(rectAt(t, 0.7, 0.7), r, 0.1)) placer.decor(pre, 'decor/tires', t, random)
      }
    }
  }
  return placer.items
}

/** Facing that turns a front (+Z at 0) toward the street side. */
function facingTo(side: Side): QuarterTurns {
  return side === 'S' ? 0 : side === 'E' ? 1 : side === 'N' ? 2 : 3
}

/** Which long edge of a sidewalk strip touches a carriageway (`min`: its min X/Z edge). */
function kerbSide(s: StreetSurface, carriage: readonly StreetSurface[]): 'min' | 'max' {
  const r = s.rect
  const alongX = r.maxX - r.minX >= r.maxZ - r.minZ
  const touches = (edge: number) => carriage.some((c) => (alongX ? Math.abs(c.rect.maxZ - edge) < 0.05 || Math.abs(c.rect.minZ - edge) < 0.05 : Math.abs(c.rect.maxX - edge) < 0.05 || Math.abs(c.rect.minX - edge) < 0.05) && rectsOverlap(c.rect, { minX: r.minX - 0.1, minZ: r.minZ - 0.1, maxX: r.maxX + 0.1, maxZ: r.maxZ + 0.1 }))
  return touches(alongX ? r.minZ : r.minX) ? 'min' : 'max'
}

/**
 * Rules of the environment (tests and callers), as messages: colliders clear of buildings, doors
 * and entrance paths; cars leave a 3.5 m lane of carriageway; every item inside the plan area.
 */
export function checkEnvironment(plan: LayoutPlan, placed: ReadonlyMap<string, PlacedPrefab>, items: readonly EnvItem[]): string[] {
  const out: string[] = []
  const keep = keepOuts(plan, placed)
  const hard = [...placed.values()].map((p) => p.build.footprint)
  for (const it of items) {
    if (it.at.x < plan.area.minX || it.at.x > plan.area.maxX || it.at.z < plan.area.minZ || it.at.z > plan.area.maxZ) out.push(`${it.name} ngoài vùng`)
    if (it.kind === 'decor') continue
    const r = it.kind === 'tree' ? rectAt(it.at, 2 * it.trunk, 2 * it.trunk) : rectAt(it.at, it.size[0], it.size[2])
    // Mailboxes at a prefab anchor may sit in the door clearance but never on the footprint.
    const rules = it.kind !== 'tree' && it.assetId === 'outdoor/mailbox' ? hard : keep
    if (rules.some((k) => rectsOverlap(k, r))) out.push(`${it.name} chắn công trình/cửa/lối vào`)
    if (it.kind !== 'tree' && it.assetId === 'outdoor/car') {
      const road = plan.surfaces.find((s) => s.kind === 'asphalt' && inside(r, s.rect, 0))
      if (!road) out.push(`${it.name} không nằm trọn trên lòng đường`)
      else {
        const alongX = road.rect.maxX - road.rect.minX >= road.rect.maxZ - road.rect.minZ
        const clear = alongX ? Math.max(r.minZ - road.rect.minZ, road.rect.maxZ - r.maxZ) : Math.max(r.minX - road.rect.minX, road.rect.maxX - r.maxX)
        if (clear < ROAD_CLEAR - 1e-6) out.push(`${it.name} để lại ${clear.toFixed(1)} m lòng đường`)
      }
    }
  }
  return out
}
