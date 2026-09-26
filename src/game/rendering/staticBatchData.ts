import { Vector3 } from 'three'
import type { MapData } from '../world/mapData'
import type { BuildingInfo } from '../world/buildings'
import { outlineRects, pointInOutline } from '../../map/polygon'
import type { Rect } from '../../map/schema'
import type { StaticColliderRegistry } from '../world/staticColliders'
import { TREE_TRUNK_COLOR, treeProfile } from '../world/trees'
import { itemChunkKey } from './viewChunks'

/**
 * R3b: what `StaticBatches` draws, as plain data: every wall/prop box (from the collider registry),
 * container body, building floor and roof, and how they fall into chunks.
 */

/** Khối cao hơn ngưỡng này mới được làm mờ khi che nhân vật. */
const OCCLUDER_MIN_HEIGHT = 1.5
const DEFAULT_WALL_COLOR = '#5a5650'
const ROOF_THICKNESS = 0.2
const ROOF_OVERHANG = 0.3
/** Floors sit just above the ground plane. */
const FLOOR_Y = 0.02
/** Box sizes come back from min/max: round away float noise so equal pieces share one geometry. */
const round = (v: number) => Math.round(v * 1e6) / 1e6

/** M9: `trunk` (cylinder), `crown` (round canopy) and `cone` (pine canopy) for trees. */
export type Shape = 'box' | 'floor' | 'trunk' | 'crown' | 'cone'

export interface StaticItem {
  shape: Shape
  center: Vector3
  /** Box size, floor size with y ignored, or the bounding box of a tree part. */
  size: [number, number, number]
  color: string
  /** Tall wall or roof: fades when it hides the player. */
  occluder: boolean
  /** Roof of this building (hidden while the player is inside it). */
  roofOf?: string
}

/** Everything static to draw, from runtime data (colliders, containers, buildings). */
export function collectStaticItems(map: MapData, colliders: StaticColliderRegistry): StaticItem[] {
  const items: StaticItem[] = []
  // Tree trunks are walls (collider, nav, sight) but are drawn as trees below.
  const trunks = new Set((map.trees ?? []).map((t) => t.id))
  for (const w of colliders.list('wall')) {
    if (trunks.has(w.id)) continue
    const size: [number, number, number] = [round(w.max.x - w.min.x), round(w.max.y - w.min.y), round(w.max.z - w.min.z)]
    items.push({
      shape: 'box',
      center: new Vector3((w.min.x + w.max.x) / 2, (w.min.y + w.max.y) / 2, (w.min.z + w.max.z) / 2),
      size,
      color: w.color ?? DEFAULT_WALL_COLOR,
      occluder: size[1] >= OCCLUDER_MIN_HEIGHT,
    })
  }
  for (const c of map.containers) {
    items.push({ shape: 'box', center: new Vector3(c.position.x, c.position.y, c.position.z), size: [...c.size], color: c.color, occluder: false })
  }
  for (const b of map.buildings) {
    // M11a: an L/T/U building is floored and roofed piece by piece (rectangles tiling its outline).
    for (const piece of buildingPieces(b)) {
      const w = piece.maxX - piece.minX
      const d = piece.maxZ - piece.minZ
      const cx = (piece.minX + piece.maxX) / 2
      const cz = (piece.minZ + piece.maxZ) / 2
      items.push({ shape: 'floor', center: new Vector3(cx, FLOOR_Y, cz), size: [w, 0, d], color: b.floorColor, occluder: false })
      // The overhang grows only the piece's outer sides, so pieces never overlap (no z-fighting).
      const o = piece.overhang
      items.push({
        shape: 'box',
        center: new Vector3(cx + (o.maxX - o.minX) / 2, b.height + ROOF_THICKNESS / 2, cz + (o.maxZ - o.minZ) / 2),
        size: [w + o.minX + o.maxX, ROOF_THICKNESS, d + o.minZ + o.maxZ],
        color: b.roofColor,
        // Mái cũng là vật che: khi người chơi đứng ngoài, sát tường phía trên màn hình, mái nằm giữa camera và nhân vật.
        occluder: true,
        roofOf: b.id,
      })
    }
  }
  for (const t of map.trees ?? []) {
    const f = treeProfile(t)
    items.push({ shape: 'trunk', center: new Vector3(t.position.x, f.trunkHeight / 2, t.position.z), size: [2 * t.trunk, f.trunkHeight, 2 * t.trunk], color: TREE_TRUNK_COLOR, occluder: false })
    const depth = f.canopyTop - f.canopyBottom
    // The canopy fades like a roof when it hides the player; it blocks nothing.
    items.push({ shape: t.style === 'pine' ? 'cone' : 'crown', center: new Vector3(t.position.x, f.canopyBottom + depth / 2, t.position.z), size: [2 * t.canopy, depth, 2 * t.canopy], color: t.color, occluder: true })
  }
  return items
}

type Piece = Rect & { overhang: Rect }

/**
 * Floor/roof rectangles of a building: its footprint, or (M11a) the rectangles tiling its outline.
 * `overhang` is how far the roof reaches past each side (0 on sides shared with another piece).
 */
export function buildingPieces(b: BuildingInfo): Piece[] {
  const O = ROOF_OVERHANG
  if (!b.outline) {
    const r = { minX: b.center.x - b.size.w / 2, minZ: b.center.z - b.size.d / 2, maxX: b.center.x + b.size.w / 2, maxZ: b.center.z + b.size.d / 2 }
    return [{ ...r, overhang: { minX: O, minZ: O, maxX: O, maxZ: O } }]
  }
  const outline = b.outline
  const rects = outlineRects(outline)
  // A side is outer when the point just past its middle is outside the building.
  const out = (x: number, z: number) => !pointInOutline(outline, x, z)
  const e = 1e-3
  return rects.map((r) => {
    const mx = (r.minX + r.maxX) / 2
    const mz = (r.minZ + r.maxZ) / 2
    return {
      ...r,
      overhang: {
        minX: out(r.minX - e, mz) ? O : 0,
        maxX: out(r.maxX + e, mz) ? O : 0,
        minZ: out(mx, r.minZ - e) ? O : 0,
        maxZ: out(mx, r.maxZ + e) ? O : 0,
      },
    }
  })
}

/**
 * Items per chunk key `cx,cz` (chunk of the item centre), in collection order; items longer than a
 * chunk (fence, long walls) go to `WIDE_KEY` (M10: always mounted, whatever chunks are shown).
 */
export function groupByChunk(items: StaticItem[], chunkSize: number): Map<string, StaticItem[]> {
  const byChunk = new Map<string, StaticItem[]>()
  for (const item of items) {
    const key = itemChunkKey(item.center.x, item.center.z, item.size[0], item.size[2], chunkSize)
    const list = byChunk.get(key)
    if (list) list.push(item)
    else byChunk.set(key, [item])
  }
  return byChunk
}
