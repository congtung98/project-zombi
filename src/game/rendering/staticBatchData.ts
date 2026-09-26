import { Vector3 } from 'three'
import type { MapData } from '../world/mapData'
import { isInsideBuilding, roofHeight, type BuildingInfo } from '../world/buildings'
import type { ArchRole } from './cutaway'
import { SLAB_THICKNESS, type StairPlacement } from '../world/floors'
import { outlineRects, pointInOutline } from '../../map/polygon'
import type { Rect } from '../../map/schema'
import type { StaticColliderRegistry } from '../world/staticColliders'
import { TREE_TRUNK_COLOR, treeProfile } from '../world/trees'
import { itemChunkKey } from './viewChunks'
import { packSurface } from './surfaces/catalog'
import { outdoorSurface, PIECE_SURFACES, roadSurface, SLAB_SURFACE, STAIR_SURFACE, wallSurface } from './surfaces/surfaceRules'
import { doorDetails, roomFloorDetails, stoopDetail, TRIM, wallBaseDetails, windowDetails } from './architecture'
import { mapRooms, mapWindows, roadY, type RoadDef } from '../world/mapData'
import type { FurnitureLook } from '../world/buildings'
import type { QuarterTurns } from '../../map/schema'
import { isFurnitureId, type FurnitureId } from './furniture/catalog'
import { lookParts, type WorldBox } from './furniture/placement'
import { placeDecorParts } from './decor/assets'
import { isDecorId, type DecorId } from './decor/catalog'
import { isVariantId, variantColor, type VariantId } from './variants'
import { ROOM_FLOOR_LIFT } from './architecture'
import type { DecorDef } from '../world/buildings'

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

/** G2: roof pitch (rise over half the short side of a roof piece). */
const ROOF_PITCH = Math.tan((22 * Math.PI) / 180)
/** G2: ridge lengths are rounded to this share of the long side (a few shared hip geometries). */
const RIDGE_STEP = 0.02

/**
 * M9: `trunk` (cylinder), `crown` (round canopy) and `cone` (pine canopy) for trees. G2: `hip`, a
 * hipped roof (see `hip` on the item).
 */
export type Shape = 'box' | 'floor' | 'trunk' | 'crown' | 'cone' | 'hip'

/**
 * G2: a hipped roof's ridge: along `axis`, half its length as a share of the unit shape (0 = a
 * pyramid), so all four slopes are equally steep once scaled.
 */
export interface HipShape {
  axis: 'x' | 'z'
  ridge: number
}

export interface StaticItem {
  shape: Shape
  center: Vector3
  /** Box size, floor size with y ignored, or the bounding box of a tree part. */
  size: [number, number, number]
  color: string
  /** Tall wall or roof: fades when it hides the player. */
  occluder: boolean
  /** Roof of this building. */
  roofOf?: string
  /** M11c-1A: building this piece belongs to (the cutaway cuts or hides it with the building). */
  buildingId?: string
  /** M11c-1A: what the piece is, for the cutaway rules; set on building pieces. */
  role?: ArchRole
  /** Source ID (walls, props, containers, slabs), for tests and the debug. */
  id?: string
  /** G1: packed surfaces (`surfaces/catalog.packSurface`): which detail texture each face reads. */
  surface: number
  /** G2: the ridge of a `hip` roof. */
  hip?: HipShape
  /**
   * G2: the wall or opening a detail belongs to (frames, sills, baseboards). The cutaway classifies
   * and the fader tests the detail with this box, so it is cut, hidden and faded with its owner.
   */
  anchor?: { min: Vector3; max: Vector3 }
  /** G2: a drawn-only architectural detail (`architecture.ts`: frame, sill, baseboard, plinth, room floor, stoop). */
  detail?: boolean
  /**
   * G3a: a part of a furniture asset drawn in place of its prop's or container's box; `anchor` is that
   * box (cutaway and fader treat the piece of furniture as one). `facing` is the one used (given or automatic).
   */
  furniture?: { assetId: FurnitureId; part: string; facing: QuarterTurns }
  /** G3b: a part of a decor object (drawn only); `anchor` is the whole decor's bounds. */
  decor?: { assetId: DecorId | 'unknown'; part: string }
  /**
   * G3b: turn about +Y through the centre (radians; a chair pulled out askew, decor). Absent = axis
   * aligned like everything else; the cutaway and the fader then use the turned box's bounds.
   */
  yaw?: number
}

/** World bounds of an item (G3b: of its turned box when it has a yaw). */
export function itemBounds(item: Pick<StaticItem, 'center' | 'size' | 'shape' | 'yaw'>): { min: Vector3; max: Vector3 } {
  const { center, size, shape, yaw } = item
  const c = yaw ? Math.abs(Math.cos(yaw)) : 1
  const s = yaw ? Math.abs(Math.sin(yaw)) : 0
  const hx = (c * size[0] + s * size[2]) / 2
  const hz = (s * size[0] + c * size[2]) / 2
  const hy = shape === 'floor' ? 0 : size[1] / 2
  return { min: new Vector3(center.x - hx, center.y - hy, center.z - hz), max: new Vector3(center.x + hx, center.y + hy, center.z + hz) }
}

/** Ground cell size of the building lookup below (m). */
const MEMBER_CELL = 16
/** A piece whose centre is this close outside a footprint still belongs to it (walls on the edge). */
const MEMBER_MARGIN = 0.2

/**
 * M11c-1A: which building a static piece belongs to. By ID first (resolved prefab parts are
 * `<instance>/<local>` or `<instance>#<part>`, parametric ones `<building>-…`), else by position
 * (its centre in or on the edge of a footprint), for pieces whose ID says nothing.
 */
export function buildingMembership(buildings: readonly BuildingInfo[]): (id: string, x: number, z: number) => string | undefined {
  const ids = new Set(buildings.map((b) => b.id))
  const cells = new Map<string, BuildingInfo[]>()
  for (const b of buildings) {
    const x0 = Math.floor((b.center.x - b.size.w / 2 - MEMBER_MARGIN) / MEMBER_CELL)
    const x1 = Math.floor((b.center.x + b.size.w / 2 + MEMBER_MARGIN) / MEMBER_CELL)
    const z0 = Math.floor((b.center.z - b.size.d / 2 - MEMBER_MARGIN) / MEMBER_CELL)
    const z1 = Math.floor((b.center.z + b.size.d / 2 + MEMBER_MARGIN) / MEMBER_CELL)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = `${cx},${cz}`
        const list = cells.get(key)
        if (list) list.push(b)
        else cells.set(key, [b])
      }
    }
  }
  return (id, x, z) => {
    for (let i = id.length - 1; i > 0; i--) {
      const c = id[i]
      if ((c === '/' || c === '#' || c === '-') && ids.has(id.slice(0, i))) return id.slice(0, i)
    }
    for (const b of cells.get(`${Math.floor(x / MEMBER_CELL)},${Math.floor(z / MEMBER_CELL)}`) ?? []) {
      if (isInsideBuilding(b, x, z, MEMBER_MARGIN)) return b.id
    }
    return undefined
  }
}

/** Everything static to draw, from runtime data (colliders, containers, buildings). */
export function collectStaticItems(map: MapData, colliders: StaticColliderRegistry): StaticItem[] {
  const items: StaticItem[] = []
  const memberOf = buildingMembership(map.buildings)
  // Tree trunks are walls (collider, nav, sight) but are drawn as trees below.
  const trunks = new Set((map.trees ?? []).map((t) => t.id))
  const props = new Set(map.walls.filter((w) => w.prop).map((w) => w.id))
  const looks = new Map<string, FurnitureLook>()
  for (const w of map.walls) if (w.visual) looks.set(w.id, w.visual)
  const buildingById = new Map(map.buildings.map((b) => [b.id, b]))
  // G3a: boxes drawn as furniture assets, placed once every wall is known (automatic facing).
  const furnished: { item: StaticItem; look: FurnitureLook & { assetId: FurnitureId } }[] = []
  const furnish = (item: StaticItem, look: FurnitureLook | undefined): boolean => {
    if (!look || !isFurnitureId(look.assetId)) return false
    furnished.push({ item, look: { ...look, assetId: look.assetId } })
    return true
  }
  for (const w of colliders.list('wall')) {
    if (trunks.has(w.id)) continue
    const size: [number, number, number] = [round(w.max.x - w.min.x), round(w.max.y - w.min.y), round(w.max.z - w.min.z)]
    const center = new Vector3((w.min.x + w.max.x) / 2, (w.min.y + w.max.y) / 2, (w.min.z + w.max.z) / 2)
    const buildingId = memberOf(w.id, center.x, center.z)
    const prop = props.has(w.id)
    const building = buildingId ? buildingById.get(buildingId) : undefined
    const item: StaticItem = {
      shape: 'box',
      center,
      size,
      color: w.color ?? DEFAULT_WALL_COLOR,
      occluder: size[1] >= OCCLUDER_MIN_HEIGHT,
      id: w.id,
      surface: packSurface(prop ? PIECE_SURFACES.furniture : building ? wallSurface(center, size, building) : outdoorSurface(w.id)),
      ...member(buildingId, prop ? 'prop' : 'wall'),
    }
    if (!furnish(item, looks.get(w.id))) items.push(item)
  }
  for (const c of map.containers) {
    const item: StaticItem = { shape: 'box', center: new Vector3(c.position.x, c.position.y, c.position.z), size: [...c.size], color: c.color, occluder: false, id: c.id, surface: packSurface(PIECE_SURFACES.furniture), ...member(memberOf(c.id, c.position.x, c.position.z), 'container') }
    if (!furnish(item, c.visual)) items.push(item)
  }
  const variantOf = (id: string | undefined): VariantId | undefined => {
    const v = id ? buildingById.get(id)?.variant : undefined
    return isVariantId(v) ? v : undefined
  }
  items.push(...furnitureItems(furnished, items, props, variantOf))
  items.push(...architectureDetails(map, items, buildingById))
  for (const b of map.buildings) {
    // M11a: an L/T/U building is floored and roofed piece by piece (rectangles tiling its outline).
    for (const piece of buildingPieces(b)) {
      const w = piece.maxX - piece.minX
      const d = piece.maxZ - piece.minZ
      const cx = (piece.minX + piece.maxX) / 2
      const cz = (piece.minZ + piece.maxZ) / 2
      items.push({ shape: 'floor', center: new Vector3(cx, FLOOR_Y, cz), size: [w, 0, d], color: b.floorColor, occluder: false, buildingId: b.id, role: 'floor', surface: packSurface(PIECE_SURFACES.floor) })
      // The overhang grows only the piece's outer sides, so pieces never overlap (no z-fighting).
      const o = piece.overhang
      const roofCenter = new Vector3(cx + (o.maxX - o.minX) / 2, roofHeight(b) + ROOF_THICKNESS / 2, cz + (o.maxZ - o.minZ) / 2)
      const roofSize: [number, number, number] = [w + o.minX + o.maxX, ROOF_THICKNESS, d + o.minZ + o.maxZ]
      // G2: the flat roof became the eaves board (painted trim) under a hipped roof.
      items.push({
        shape: 'box',
        center: roofCenter,
        size: roofSize,
        color: TRIM.color,
        // Mái cũng là vật che: khi người chơi đứng ngoài, sát tường phía trên màn hình, mái nằm giữa camera và nhân vật.
        occluder: true,
        roofOf: b.id,
        buildingId: b.id,
        role: 'roof',
        surface: packSurface(PIECE_SURFACES.fascia),
      })
      items.push(hipRoof(roofCenter, roofSize, b))
    }
  }
  // M11b: upper floor slabs (they fade like walls when they hide the player on the storey below)
  // and the treads of every flight (drawn only; bodies climb it through `FloorField`).
  const floorColor = new Map(map.buildings.map((b) => [b.id, b.floorColor]))
  for (const s of map.floors ?? []) {
    const w = s.rect.maxX - s.rect.minX
    const d = s.rect.maxZ - s.rect.minZ
    items.push({ shape: 'box', center: new Vector3((s.rect.minX + s.rect.maxX) / 2, s.y - SLAB_THICKNESS / 2, (s.rect.minZ + s.rect.maxZ) / 2), size: [w, SLAB_THICKNESS, d], color: floorColor.get(s.buildingId) ?? DEFAULT_WALL_COLOR, occluder: true, id: s.id, buildingId: s.buildingId, role: 'slab', surface: packSurface(SLAB_SURFACE) })
  }
  for (const s of map.stairs ?? []) {
    for (const t of stairTreads(s, floorColor.get(s.buildingId) ?? DEFAULT_WALL_COLOR)) items.push({ ...t, buildingId: s.buildingId, role: 'stairs' })
  }
  for (const t of map.trees ?? []) {
    const f = treeProfile(t)
    items.push({ shape: 'trunk', center: new Vector3(t.position.x, f.trunkHeight / 2, t.position.z), size: [2 * t.trunk, f.trunkHeight, 2 * t.trunk], color: TREE_TRUNK_COLOR, occluder: false, surface: packSurface(PIECE_SURFACES.trunk) })
    const depth = f.canopyTop - f.canopyBottom
    // The canopy fades like a roof when it hides the player; it blocks nothing.
    items.push({ shape: t.style === 'pine' ? 'cone' : 'crown', center: new Vector3(t.position.x, f.canopyBottom + depth / 2, t.position.z), size: [2 * t.canopy, depth, 2 * t.canopy], color: t.color, occluder: true, surface: packSurface(PIECE_SURFACES.canopy) })
  }
  // G4: paint on the streets and kerbs where a pavement meets one (drawn only).
  items.push(...roadDetails(map.roads))
  // G3b: decor (drawn only), then the house variants' palette on every piece of a house but decor.
  for (const d of map.decor ?? []) items.push(...decorItems(d, memberOf(d.id, d.position.x, d.position.z)))
  for (const item of items) {
    const v = variantOf(item.buildingId)
    if (v && !item.decor) item.color = variantColor(item.color, v)
  }
  return items
}

/** G4: street paint and kerbs (drawn only, no collider: a kerb is low enough to step over). */
export const ROAD_PAINT = { color: '#d9d3bf', width: 0.12, dash: 1.6, gap: 1.6, minWidth: 4, minLength: 8 } as const
export const KERB = { color: '#aaa49a', width: 0.18, height: 0.05 } as const

/**
 * G4: a dashed centre line along every asphalt street (at least 4 m wide and 8 m long) and a kerb
 * along each pavement (concrete) edge that meets asphalt, on the pavement side. Worked out from the
 * roads themselves, so every map gets them without authoring.
 */
export function roadDetails(roads: readonly RoadDef[]): StaticItem[] {
  const out: StaticItem[] = []
  const rect = (r: RoadDef) => ({ minX: r.position.x - r.size[0] / 2, maxX: r.position.x + r.size[0] / 2, minZ: r.position.z - r.size[1] / 2, maxZ: r.position.z + r.size[1] / 2 })
  const asphalt = roads.filter((r) => roadSurface(r.color) === 'asphalt')
  for (const r of asphalt) {
    const alongX = r.size[0] >= r.size[1]
    const length = Math.max(r.size[0], r.size[1])
    const width = Math.min(r.size[0], r.size[1])
    if (width < ROAD_PAINT.minWidth || length < ROAD_PAINT.minLength) continue
    const y = roadY(r) + 0.002
    const period = ROAD_PAINT.dash + ROAD_PAINT.gap
    const n = Math.floor((length - ROAD_PAINT.gap) / period)
    const start = -((n * period - ROAD_PAINT.gap) / 2)
    for (let i = 0; i < n; i++) {
      const along = start + i * period + ROAD_PAINT.dash / 2
      const center = alongX ? new Vector3(r.position.x + along, y, r.position.z) : new Vector3(r.position.x, y, r.position.z + along)
      // No paint across a junction: a dash reaching into another street is left out.
      const half = ROAD_PAINT.dash / 2 + 0.3
      const crossing = asphalt.some((o) => {
        if (o === r) return false
        const q = rect(o)
        return alongX ? center.x + half > q.minX && center.x - half < q.maxX && center.z > q.minZ && center.z < q.maxZ : center.z + half > q.minZ && center.z - half < q.maxZ && center.x > q.minX && center.x < q.maxX
      })
      if (crossing) continue
      const size: [number, number, number] = alongX ? [ROAD_PAINT.dash, 0.002, ROAD_PAINT.width] : [ROAD_PAINT.width, 0.002, ROAD_PAINT.dash]
      out.push({ shape: 'box', center, size, color: ROAD_PAINT.color, occluder: false, id: `${r.id}#paint-${i}`, surface: packSurface({ a: 'matte' }), detail: true })
    }
  }
  const e = 0.02
  for (const r of roads) {
    if (roadSurface(r.color) !== 'concrete') continue
    const p = rect(r)
    for (const a of asphalt.map(rect)) {
      // Each pavement edge lying on an asphalt edge (or inside it), over their shared stretch.
      const spanX = [Math.max(p.minX, a.minX), Math.min(p.maxX, a.maxX)]
      const spanZ = [Math.max(p.minZ, a.minZ), Math.min(p.maxZ, a.maxZ)]
      const edges: { z?: number; x?: number; inward: number }[] = []
      if (spanX[1] - spanX[0] > 0.5) {
        if (Math.abs(p.maxZ - a.minZ) < e || (p.maxZ > a.minZ && p.maxZ < a.maxZ && p.minZ < a.minZ)) edges.push({ z: p.maxZ, inward: -1 })
        if (Math.abs(p.minZ - a.maxZ) < e || (p.minZ < a.maxZ && p.minZ > a.minZ && p.maxZ > a.maxZ)) edges.push({ z: p.minZ, inward: 1 })
      }
      if (spanZ[1] - spanZ[0] > 0.5) {
        if (Math.abs(p.maxX - a.minX) < e || (p.maxX > a.minX && p.maxX < a.maxX && p.minX < a.minX)) edges.push({ x: p.maxX, inward: -1 })
        if (Math.abs(p.minX - a.maxX) < e || (p.minX < a.maxX && p.minX > a.minX && p.maxX > a.maxX)) edges.push({ x: p.minX, inward: 1 })
      }
      for (const edge of edges) {
        const k = out.length
        const y = KERB.height / 2
        if (edge.z !== undefined) {
          const center = new Vector3((spanX[0] + spanX[1]) / 2, y, edge.z + (edge.inward * KERB.width) / 2)
          out.push({ shape: 'box', center, size: [round(spanX[1] - spanX[0]), KERB.height, KERB.width], color: KERB.color, occluder: false, id: `${r.id}#kerb-${k}`, surface: packSurface({ a: 'concrete' }), detail: true })
        } else {
          const center = new Vector3(edge.x! + (edge.inward * KERB.width) / 2, y, (spanZ[0] + spanZ[1]) / 2)
          out.push({ shape: 'box', center, size: [KERB.width, KERB.height, round(spanZ[1] - spanZ[0])], color: KERB.color, occluder: false, id: `${r.id}#kerb-${k}`, surface: packSurface({ a: 'concrete' }), detail: true })
        }
      }
    }
  }
  return out
}

/** Batch shape of each decor part shape. */
export const DECOR_SHAPE = { box: 'box', cyl: 'trunk', ball: 'crown', spike: 'cone' } as const satisfies Record<string, Shape>

/**
 * G3b: a decor object's parts in the world. On the floor (base at its storey's floor) it sits just
 * above the floor layers (house floor, room floor, roads), so flat decor never flickers with them.
 */
export function decorItems(d: DecorDef, buildingId: string | undefined): StaticItem[] {
  const onFloor = d.position.y - d.floorY < 0.005
  const lift = !onFloor ? 0 : buildingId ? (d.floorY < 0.01 ? FLOOR_Y : 0) + ROOM_FLOOR_LIFT + 0.002 : OUTDOOR_DECOR_LIFT
  const parts = placeDecorParts(d.assetId, { x: d.position.x, y: d.position.y + lift, z: d.position.z }, d.yaw, d.color)
  const out: StaticItem[] = parts.map((p) => {
    const yaw = p.worldYaw
    return {
      shape: DECOR_SHAPE[p.shape],
      center: new Vector3(round(p.world[0]), round(p.world[1]), round(p.world[2])),
      size: [p.size[0], p.size[1], p.size[2]],
      color: p.color,
      occluder: false,
      id: d.id,
      surface: packSurface({ a: p.surface }),
      decor: { assetId: isDecorId(d.assetId) ? d.assetId : 'unknown', part: p.name },
      ...(yaw ? { yaw } : {}),
      ...member(buildingId, 'prop'),
    }
  })
  // The cutaway and the fader treat the decor as one piece: its bounds.
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = new Vector3(-Infinity, -Infinity, -Infinity)
  for (const i of out) {
    const b = itemBounds(i)
    min.min(b.min)
    max.max(b.max)
  }
  for (const i of out) i.anchor = { min, max }
  return out
}

/** Flat decor outdoors sits above the road layers (up to 14 mm) and below any floor (20 mm). */
const OUTDOOR_DECOR_LIFT = 0.016

/**
 * G2: a hipped roof on an eaves board (`center`/`size` of the board): its ridge runs along the longer
 * side, every slope rises `ROOF_PITCH` over half the short side.
 */
export function hipRoof(board: Vector3, boardSize: readonly [number, number, number], b: BuildingInfo): StaticItem {
  const [sx, , sz] = boardSize
  const long = Math.max(sx, sz)
  const short = Math.min(sx, sz)
  const rise = round((short / 2) * ROOF_PITCH)
  const ridge = Math.max(0, Math.round((0.5 - short / (2 * long)) / RIDGE_STEP) * RIDGE_STEP)
  return {
    shape: 'hip',
    hip: { axis: sx >= sz ? 'x' : 'z', ridge: round(ridge) },
    center: new Vector3(board.x, board.y + boardSize[1] / 2 + rise / 2, board.z),
    size: [sx, rise, sz],
    color: b.roofColor,
    occluder: true,
    roofOf: b.id,
    buildingId: b.id,
    role: 'roof',
    surface: packSurface(PIECE_SURFACES.roof),
  }
}

/**
 * G2: frames, sills, baseboards, plinths, per-room floors and stoops (`architecture.ts`), from the
 * wall pieces collected so far (a door's wall thickness is its lintel's).
 */
function architectureDetails(map: MapData, collected: readonly StaticItem[], buildings: ReadonlyMap<string, BuildingInfo>): StaticItem[] {
  const out: StaticItem[] = []
  const walls = collected.filter((i) => i.role === 'wall' && i.buildingId)
  for (const w of walls) out.push(...wallBaseDetails(w, buildings.get(w.buildingId!)!))
  const lintelThickness = (x: number, y: number, z: number, alongX: boolean, fallback: number) => {
    for (const w of walls) {
      const [sx, sy, sz] = w.size
      if (Math.abs(x - w.center.x) <= sx / 2 && Math.abs(y - w.center.y) <= sy / 2 && Math.abs(z - w.center.z) <= sz / 2) return alongX ? sz : sx
    }
    return fallback
  }
  for (const door of map.doors) {
    const b = buildings.get(door.buildingId)
    if (!b) continue
    const alongX = door.hinge.x !== door.center.x
    const t = lintelThickness(door.center.x, door.center.y + door.height + 0.05, door.center.z, alongX, b.wallThickness)
    out.push(...doorDetails(door, t))
    const stoop = stoopDetail(door, t, b)
    if (stoop) out.push(stoop)
  }
  for (const win of mapWindows(map)) if (buildings.has(win.buildingId)) out.push(...windowDetails(win))
  for (const room of mapRooms(map)) {
    const b = buildings.get(room.buildingId)
    if (b) out.push(...roomFloorDetails(room, b, map.stairs ?? [], FLOOR_Y))
  }
  return out
}

/**
 * G3a: the parts of every furnished box. The facing is the content's, or the back to the nearest wall
 * of the same building (outside buildings: loose walls, not other props).
 */
function furnitureItems(
  furnished: readonly { item: StaticItem; look: FurnitureLook & { assetId: FurnitureId } }[],
  collected: readonly StaticItem[],
  props: ReadonlySet<string>,
  variantOf: (buildingId: string | undefined) => VariantId | undefined,
): StaticItem[] {
  const out: StaticItem[] = []
  const boxOf = (i: StaticItem): WorldBox => ({
    min: { x: i.center.x - i.size[0] / 2, y: i.center.y - i.size[1] / 2, z: i.center.z - i.size[2] / 2 },
    max: { x: i.center.x + i.size[0] / 2, y: i.center.y + i.size[1] / 2, z: i.center.z + i.size[2] / 2 },
  })
  const walls = collected.filter((i) => i.shape === 'box' && !(i.id && props.has(i.id)) && (i.role === 'wall' || !i.role))
  for (const { item, look } of furnished) {
    const box = boxOf(item)
    const anchor = { min: new Vector3(box.min.x, box.min.y, box.min.z), max: new Vector3(box.max.x, box.max.y, box.max.z) }
    // G3b: the content's look, else the house variant's default for this asset (G5: `lookParts`, shared with the editor).
    const placed = lookParts(look, box, item.color, walls.filter((w) => w.buildingId === item.buildingId).map(boxOf), variantOf(item.buildingId))!
    const facing = placed.facing
    for (const p of placed.parts) {
      out.push({
        ...item,
        // Rounded like the sizes: a turned copy gives the very same piece (no float noise).
        center: new Vector3(round(p.center[0]), round(p.center[1]), round(p.center[2])),
        size: [round(p.size[0]), round(p.size[1]), round(p.size[2])],
        color: p.color,
        surface: packSurface({ a: p.surface }),
        anchor,
        furniture: { assetId: look.assetId, part: p.name, facing },
        ...(p.yaw ? { yaw: p.yaw } : {}),
      })
    }
  }
  return out
}

/** Membership fields of a building piece (none outside buildings). */
function member(buildingId: string | undefined, role: ArchRole): Pick<StaticItem, 'buildingId' | 'role'> {
  return buildingId ? { buildingId, role } : {}
}

/** Tread height of drawn stairs (m); the count follows the rise. */
const TREAD_RISE = 0.2

/** Boxes of a flight's steps, each from the lower floor up to its tread (a solid staircase). */
export function stairTreads(s: StairPlacement, color: string): StaticItem[] {
  const rise = s.topY - s.bottomY
  const n = Math.max(1, Math.round(rise / TREAD_RISE))
  const run = s.length / n
  const out: StaticItem[] = []
  const cx = (s.rect.minX + s.rect.maxX) / 2
  const cz = (s.rect.minZ + s.rect.maxZ) / 2
  for (let i = 0; i < n; i++) {
    const top = (rise * (i + 1)) / n
    // Step i spans [i·run, (i+1)·run] from the bottom edge along the climb.
    const along = -s.length / 2 + (i + 0.5) * run
    const c = s.axis === 'x' ? new Vector3(cx + s.dir * along, s.bottomY + top / 2, cz) : new Vector3(cx, s.bottomY + top / 2, cz + s.dir * along)
    const size: [number, number, number] = s.axis === 'x' ? [round(run), round(top), s.width] : [s.width, round(top), round(run)]
    out.push({ shape: 'box', center: c, size, color, occluder: false, surface: packSurface(STAIR_SURFACE) })
  }
  return out
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
