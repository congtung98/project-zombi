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
import { outdoorSurface, PIECE_SURFACES, SLAB_SURFACE, STAIR_SURFACE, wallSurface } from './surfaces/surfaceRules'
import { doorDetails, roomFloorDetails, stoopDetail, TRIM, wallBaseDetails, windowDetails } from './architecture'
import { mapRooms, mapWindows } from '../world/mapData'

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
  const buildingById = new Map(map.buildings.map((b) => [b.id, b]))
  for (const w of colliders.list('wall')) {
    if (trunks.has(w.id)) continue
    const size: [number, number, number] = [round(w.max.x - w.min.x), round(w.max.y - w.min.y), round(w.max.z - w.min.z)]
    const center = new Vector3((w.min.x + w.max.x) / 2, (w.min.y + w.max.y) / 2, (w.min.z + w.max.z) / 2)
    const buildingId = memberOf(w.id, center.x, center.z)
    const prop = props.has(w.id)
    const building = buildingId ? buildingById.get(buildingId) : undefined
    items.push({
      shape: 'box',
      center,
      size,
      color: w.color ?? DEFAULT_WALL_COLOR,
      occluder: size[1] >= OCCLUDER_MIN_HEIGHT,
      id: w.id,
      surface: packSurface(prop ? PIECE_SURFACES.furniture : building ? wallSurface(center, size, building) : outdoorSurface(w.id)),
      ...member(buildingId, prop ? 'prop' : 'wall'),
    })
  }
  for (const c of map.containers) {
    items.push({ shape: 'box', center: new Vector3(c.position.x, c.position.y, c.position.z), size: [...c.size], color: c.color, occluder: false, id: c.id, surface: packSurface(PIECE_SURFACES.furniture), ...member(memberOf(c.id, c.position.x, c.position.z), 'container') })
  }
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
  return items
}

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
