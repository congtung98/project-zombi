import { rotateXZ } from '../../../map/transform'
import type { QuarterTurns } from '../../../map/schema'
import { FURNITURE, type FurnitureId } from './catalog'
import { furnitureParts, type FurniturePart } from './assets'

/**
 * G3a: an asset's parts placed in the world box of its prop or container. Boxes are axis-aligned
 * (a turned prefab swaps X and Z), so a facing only permutes axes: the parts stay axis-aligned boxes
 * and are drawn in the static batches like everything else (no new draw call, the local surface
 * mapping keeps the grain on each part).
 */

export interface WorldBox {
  min: { x: number; y: number; z: number }
  max: { x: number; y: number; z: number }
}

export interface PlacedPart extends FurniturePart {
  /** World bounds (of the turned part when `yaw` is set). */
  min: [number, number, number]
  max: [number, number, number]
  /** World centre and size before the yaw (the batch instance). */
  center: [number, number, number]
  size: [number, number, number]
  /** G3b: turn about +Y through `center` (radians). */
  yaw?: number
}

export interface PlaceOptions {
  /** G3b: turn of the whole asset about the box centre (radians); it shrinks to stay inside the box. */
  yaw?: number
  /** G3b: asset variant (`FURNITURE_VARIANTS`); unknown or none = the asset's default. */
  variant?: string
}

/**
 * Share of the box an asset turned by `yaw` may fill so that its turned footprint stays inside the
 * box (a chair pulled out askew is a smaller chair in the same collider).
 */
export function yawFit(sx: number, sz: number, yaw: number): number {
  const c = Math.abs(Math.cos(yaw))
  const s = Math.abs(Math.sin(yaw))
  return Math.min(1, sx / (sx * c + sz * s), sz / (sx * s + sz * c))
}

/** Width across the front and depth for a world box `sx` × `sz` faced `q`. */
export function assetDims(size: readonly [number, number, number], q: QuarterTurns): { w: number; h: number; d: number } {
  return (q & 1) === 0 ? { w: size[0], h: size[1], d: size[2] } : { w: size[2], h: size[1], d: size[0] }
}

/**
 * The parts of `asset` filling `box`, its front towards `rotateXZ(0, 1, facing)`; G3b: turned by
 * `yaw` about the box centre (a positive yaw turns +X towards −Z, like `rotation.y`).
 */
export function placeFurniture(asset: FurnitureId, box: WorldBox, facing: QuarterTurns, color: string, opts: PlaceOptions = {}): PlacedPart[] {
  const yaw = opts.yaw ?? 0
  const k = yaw ? yawFit(box.max.x - box.min.x, box.max.z - box.min.z, yaw) : 1
  const size: [number, number, number] = [(box.max.x - box.min.x) * k, box.max.y - box.min.y, (box.max.z - box.min.z) * k]
  const cx = (box.min.x + box.max.x) / 2
  const cz = (box.min.z + box.max.z) / 2
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  return furnitureParts(asset, assetDims(size, facing), color, opts.variant).map((p) => {
    const [ax, az] = rotateXZ(p.min[0], p.min[2], facing)
    const [bx, bz] = rotateXZ(p.max[0], p.max[2], facing)
    const sx = Math.abs(bx - ax)
    const sz = Math.abs(bz - az)
    const sy = p.max[1] - p.min[1]
    const ox = (ax + bx) / 2
    const oz = (az + bz) / 2
    const center: [number, number, number] = [cx + ox * cos + oz * sin, box.min.y + (p.min[1] + p.max[1]) / 2, cz - ox * sin + oz * cos]
    const hx = (Math.abs(cos) * sx + Math.abs(sin) * sz) / 2
    const hz = (Math.abs(sin) * sx + Math.abs(cos) * sz) / 2
    return {
      ...p,
      min: [center[0] - hx, box.min.y + p.min[1], center[2] - hz],
      max: [center[0] + hx, box.min.y + p.max[1], center[2] + hz],
      center,
      size: [sx, sy, sz],
      ...(yaw ? { yaw } : {}),
    }
  })
}

/** How far from a wall face a box side still counts as standing against it (m). */
const WALL_GAP = 0.3
/** Share of a side that must be covered by walls to count. */
const WALL_COVER = 0.5

/**
 * Facing of an asset whose content leaves it out: its back against a wall. A side is against a wall
 * when wall boxes within `WALL_GAP` behind it cover at least half of it at the asset's height.
 * Among such sides the one that gives the asset its usual shape wins (a bed deeper than wide), then
 * the first in facing order; with no wall, the facing that gives the usual shape (south or east).
 * Facing order and the fallback start at `turn` (the prefab instance's quarter turns), so the
 * choice is made in the prefab's frame and a turned copy of a house turns it along.
 */
export function autoFacing(asset: FurnitureId, box: WorldBox, walls: readonly WorldBox[], turn: QuarterTurns = 0): QuarterTurns {
  const deep = FURNITURE[asset].deep
  const sx = box.max.x - box.min.x
  const sz = box.max.z - box.min.z
  const shaped = (q: QuarterTurns) => {
    const { w, d } = assetDims([sx, 0, sz], q)
    return deep ? d >= w : w >= d
  }
  const near = walls.filter((w) => w.min.y < box.max.y - 0.05 && w.max.y > box.min.y + 0.05)
  // Covered length of a side: along X for the north/south sides, along Z for east/west.
  const cover = (q: QuarterTurns) => {
    let sum = 0
    for (const w of near) {
      // q = back side: 0 back north (−Z), 1 back west (−X), 2 back south (+Z), 3 back east (+X).
      const gap = q === 0 ? box.min.z - w.max.z : q === 1 ? box.min.x - w.max.x : q === 2 ? w.min.z - box.max.z : w.min.x - box.max.x
      if (gap < -0.02 || gap > WALL_GAP) continue
      sum += (q & 1) === 0 ? Math.max(0, Math.min(box.max.x, w.max.x) - Math.max(box.min.x, w.min.x)) : Math.max(0, Math.min(box.max.z, w.max.z) - Math.max(box.min.z, w.min.z))
    }
    return sum / ((q & 1) === 0 ? sx : sz)
  }
  const order = [0, 1, 2, 3].map((k) => ((turn + k) % 4) as QuarterTurns)
  const against = order.filter((q) => cover(q) >= WALL_COVER)
  return against.find(shaped) ?? against[0] ?? (shaped(order[0]) ? order[0] : order[1])
}
