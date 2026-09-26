import type { Vec3 } from '../../types'
import type { Rect } from '../../map/schema'
import { mapWindows, type MapData } from './mapData'
import { BREACH_COST, NavGrid, type DoorPortal, type DoorRoute, type NavGridOptions } from './navigation'
import type { DoorStatus } from './doors'
import { FloorField, inRect, LEVEL_TOLERANCE, stairApproach, stairProgress, type StairPlacement } from './floors'

/**
 * M11b: navigation over storeys. Every storey is its own `NavGrid` (layer 0 = the ground over the
 * whole play area, one layer per upper storey of a building over that building); flights join a
 * point just past their bottom end on the lower layer to a point just past their top end on the
 * upper one. A route that stays on one layer is exactly that grid's route; a route across layers is
 * planned over the flights (Dijkstra over their ends, like `findDoorRoute` over doors), then each leg
 * on a layer is that layer's A* and each flight is walked straight.
 *
 * A world without upper floors has one layer and every call goes straight to the ground grid, so
 * single-storey worlds route exactly as before.
 */

/** Vertical band a layer's obstacles are taken from: a wall blocks when it overlaps [floor + MIN_TOP, floor + OVERHEAD). */
const MIN_TOP = 0.05
const OVERHEAD = 1.6
/** Grid cell (m) of the layer index. */
const CELL = 16

export interface NavLayer {
  index: number
  /** Floor height (0 for the ground). */
  elevation: number
  /** Building of an upper storey; null for the ground. */
  buildingId: string | null
  level: number
  grid: NavGrid
  /** Ground rectangle of an upper storey (the union of its slabs); null = the whole play area. */
  bounds: Rect | null
}

export interface NavStair {
  stair: StairPlacement
  lower: number
  upper: number
  /** Where bodies step on and off: past the bottom end (lower layer) and past the top end (upper layer). */
  ends: [Vec3, Vec3]
  /** Walk between the two ends. */
  length: number
}

/** Where a point is: on a layer, or on flight `stair` at progress `t` (0 bottom … 1 top). */
export type NavPlace = { layer: number } | { stair: number; t: number }

interface PlanNode {
  point: Vec3
  /** `layer:region` (walkable together), or null for a point on a flight. */
  key: string | null
  layer: number
  /** Flight whose end (or a point on it) this node is; −1 otherwise. */
  stair: number
  doorId: string | null
  side: number
}

function bandOverlaps(bottom: number, top: number, floor: number): boolean {
  return bottom < floor + OVERHEAD && top > floor + MIN_TOP
}

/** The part of a map one layer is built from: its storey's walls, doors and windows, over `area`. */
function layerMap(map: MapData, floor: number, area: Rect | null): MapData {
  const walls = map.walls.filter((w) => bandOverlaps(w.position.y - w.size[1] / 2, w.position.y + w.size[1] / 2, floor))
  const doors = map.doors.filter((d) => Math.abs(d.center.y - floor) < 0.5)
  const windows = mapWindows(map).filter((w) => Math.abs(w.center.y - (w.sill + w.head) / 2 - floor) < 0.5)
  const layer: MapData = { ...map, walls, doors, windows }
  if (area) {
    layer.size = area.maxX - area.minX
    layer.depth = area.maxZ - area.minZ
    layer.center = { x: (area.minX + area.maxX) / 2, z: (area.minZ + area.maxZ) / 2 }
  }
  return layer
}

function planar(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

export class NavWorld {
  readonly layers: NavLayer[] = []
  readonly stairs: NavStair[] = []
  readonly floorField: FloorField
  /** Door portals of every layer (the ground grid's own map when there is one layer). */
  readonly portals: Map<string, DoorPortal>
  private readonly doorLayer = new Map<string, number>()
  private readonly cells = new Map<string, number[]>()
  private readonly stairIndex = new Map<string, number>()
  private readonly stairOf = new Map<StairPlacement, number>()
  /** Region links through flights, rebuilt when a door changes (`version`). */
  private links: { version: number; parent: Map<string, string>; ids: Map<string, number> } | null = null

  constructor(map: MapData, opts: NavGridOptions) {
    this.floorField = new FloorField(map.floors, map.stairs)
    const floors = map.floors ?? []
    const flights = map.stairs ?? []
    if (floors.length === 0 && flights.length === 0) {
      const grid = new NavGrid(map, opts)
      this.layers.push({ index: 0, elevation: 0, buildingId: null, level: 0, grid, bounds: null })
      this.portals = grid.portals
      for (const id of grid.portals.keys()) this.doorLayer.set(id, 0)
      return
    }

    const r = opts.agentRadius
    // Ground: the whole map at floor 0, minus the flights starting there (walled in; walked via links).
    const groundFlights = flights.filter((s) => s.level === 0)
    const ground = new NavGrid(layerMap(map, 0, null), { ...opts, floor: (x, z) => !groundFlights.some((s) => inRect(s.rect, x, z)) })
    this.layers.push({ index: 0, elevation: 0, buildingId: null, level: 0, grid: ground, bounds: null })

    // One layer per upper storey: its slabs (holes already cut out) minus the flights starting there.
    const groups = new Map<string, typeof floors>()
    for (const s of floors) {
      const key = `${s.buildingId}|${s.level}`
      const list = groups.get(key)
      if (list) list.push(s)
      else groups.set(key, [s])
    }
    const small = { cellSize: opts.cellSize, agentRadius: r }
    for (const [key, slabs] of groups) {
      const { buildingId, level, y } = slabs[0]
      const bounds = slabs.reduce<Rect>((u, s) => ({ minX: Math.min(u.minX, s.rect.minX), minZ: Math.min(u.minZ, s.rect.minZ), maxX: Math.max(u.maxX, s.rect.maxX), maxZ: Math.max(u.maxZ, s.rect.maxZ) }), { ...slabs[0].rect })
      const starting = flights.filter((s) => s.buildingId === buildingId && s.level === level)
      const floor = (x: number, z: number) => slabs.some((s) => inRect(s.rect, x, z)) && !starting.some((s) => inRect(s.rect, x, z))
      const grid = new NavGrid(layerMap(map, y, bounds), { ...small, elevation: y, floor })
      const index = this.layers.length
      this.layers.push({ index, elevation: y, buildingId, level, grid, bounds })
      this.stairIndex.set(key, index)
      for (let cz = Math.floor(bounds.minZ / CELL); cz <= Math.floor(bounds.maxZ / CELL); cz++) {
        for (let cx = Math.floor(bounds.minX / CELL); cx <= Math.floor(bounds.maxX / CELL); cx++) {
          const k = `${cx},${cz}`
          const list = this.cells.get(k)
          if (list) list.push(index)
          else this.cells.set(k, [index])
        }
      }
    }

    this.portals = new Map()
    for (const layer of this.layers) {
      for (const [id, portal] of layer.grid.portals) {
        this.portals.set(id, portal)
        this.doorLayer.set(id, layer.index)
      }
    }

    // Flights whose two ends stand on floor of their layers.
    const reach = r + opts.cellSize
    for (const s of flights) {
      const lower = s.level === 0 ? 0 : this.stairIndex.get(`${s.buildingId}|${s.level}`)
      const upper = this.stairIndex.get(`${s.buildingId}|${s.level + 1}`)
      if (lower === undefined || upper === undefined) continue
      const ends: [Vec3, Vec3] = [stairApproach(s, 0, reach), stairApproach(s, 1, reach)]
      if (!this.layers[lower].grid.isWalkable(ends[0].x, ends[0].z) || !this.layers[upper].grid.isWalkable(ends[1].x, ends[1].z)) continue
      this.stairOf.set(s, this.stairs.length)
      this.stairs.push({ stair: s, lower, upper, ends, length: s.length + 2 * reach })
    }
  }

  /** One layer and no flights: every query is the ground grid's. */
  get single(): boolean {
    return this.layers.length === 1
  }

  get ground(): NavGrid {
    return this.layers[0].grid
  }

  /** Changes whenever any layer's doors change (paths planned before are stale). */
  get version(): number {
    let v = 0
    for (const l of this.layers) v += l.grid.version
    return v
  }

  /** Layer or flight of a point (feet height `y`). */
  locate(p: Vec3): NavPlace {
    if (this.single) return { layer: 0 }
    for (const s of this.floorField.stairsNear(p.x, p.z)) {
      const i = this.stairOf.get(s)
      if (i !== undefined && inRect(s.rect, p.x, p.z) && p.y > s.bottomY + 0.05 && p.y < s.topY - 0.05) return { stair: i, t: stairProgress(s, p.x, p.z) }
    }
    return { layer: this.layerIndexAt(p) }
  }

  /** Layer a point stands on (on a flight: the nearer end's). */
  layerOf(p: Vec3): NavLayer {
    const place = this.locate(p)
    if ('layer' in place) return this.layers[place.layer]
    const s = this.stairs[place.stair]
    return this.layers[place.t < 0.5 ? s.lower : s.upper]
  }

  private layerIndexAt(p: Vec3): number {
    const list = this.cells.get(`${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`)
    if (!list) return 0
    let best = 0
    let gap = Infinity
    for (const i of list) {
      const l = this.layers[i]
      const d = Math.abs(p.y - l.elevation)
      if (d <= LEVEL_TOLERANCE && d < gap && inRect(l.bounds!, p.x, p.z, 0.5)) {
        best = i
        gap = d
      }
    }
    return best
  }

  setDoorState(id: string, state: DoorStatus): void {
    const layer = this.doorLayer.get(id)
    if (layer !== undefined) this.layers[layer].grid.setDoorState(id, state)
  }

  doorState(id: string): DoorStatus | undefined {
    const layer = this.doorLayer.get(id)
    return layer === undefined ? undefined : this.layers[layer].grid.doorState(id)
  }

  resetDoors(): void {
    for (const l of this.layers) l.grid.resetDoors()
  }

  prioritizeWarm(p: { x: number; z: number }): void {
    this.ground.prioritizeWarm(p)
  }

  /** Warm tile graphs within a budget (ground first); returns the time left. */
  warm(budgetMs: number): number {
    let left = budgetMs
    for (const l of this.layers) {
      if (left <= 0) break
      left = l.grid.tiles.warm(left)
    }
    return left
  }

  get warmed(): boolean {
    return this.layers.every((l) => l.grid.tiles.warmed)
  }

  /** Walkable ground/floor at a point of its layer. */
  isWalkable(p: Vec3): boolean {
    return this.layerOf(p).grid.isWalkable(p.x, p.z)
  }

  /** Straight walk without leaving the layer (or the flight) the two points are on. */
  hasLineOfWalk(a: Vec3, b: Vec3): boolean {
    if (this.single) return this.ground.hasLineOfWalk(a, b)
    const pa = this.locate(a)
    const pb = this.locate(b)
    if ('layer' in pa && 'layer' in pb) return pa.layer === pb.layer && this.layers[pa.layer].grid.hasLineOfWalk(a, b)
    return 'stair' in pa && 'stair' in pb && pa.stair === pb.stair
  }

  /**
   * Region of a point, with regions joined through flights: equal numbers = there is a walk between
   * them (doors as they are now). −1 = no walkable cell nearby. Comparable within one `version`.
   */
  componentAt(p: Vec3): number {
    if (this.single) return this.ground.componentAt(p.x, p.z)
    const key = this.placeKey(p)
    if (key === null) return -1
    const links = this.linkTable()
    const root = find(links.parent, key)
    let id = links.ids.get(root)
    if (id === undefined) links.ids.set(root, (id = links.ids.size))
    return id
  }

  /** Same answers as `NavGrid.routeKind`, across layers. */
  routeKind(from: Vec3, to: Vec3): 'none' | 'direct' | 'search' {
    if (this.single) return this.ground.routeKind(from, to)
    const a = this.locate(from)
    const b = this.locate(to)
    if ('layer' in a && 'layer' in b && a.layer === b.layer) {
      const kind = this.layers[a.layer].grid.routeKind(from, to)
      if (kind !== 'none') return kind
    }
    if ('stair' in a && 'stair' in b && a.stair === b.stair) return 'direct'
    const ca = this.componentAt(from)
    return ca >= 0 && ca === this.componentAt(to) ? 'search' : 'none'
  }

  /** Waypoints from → to (not including `from`), across flights when needed; null = no route. */
  findPath(from: Vec3, to: Vec3): Vec3[] | null {
    if (this.single) return this.ground.findPath(from, to)
    const a = this.locate(from)
    const b = this.locate(to)
    if ('layer' in a && 'layer' in b && a.layer === b.layer) {
      const direct = this.layers[a.layer].grid.findPath(from, to)
      if (direct) return direct
    }
    if ('stair' in a && 'stair' in b && a.stair === b.stair) return [{ ...to }]
    const nodes = this.planNodes(from, a, to, b, false)
    const route = this.dijkstra(nodes, false)
    if (!route) return null
    const out: Vec3[] = []
    for (let k = 1; k < route.length; k++) {
      const u = nodes[route[k - 1]]
      const v = nodes[route[k]]
      // A flight (end to end, or to/from a point on it) is walked straight between its walls.
      if (u.stair >= 0 && u.stair === v.stair) {
        out.push({ ...v.point })
        continue
      }
      const leg = this.layers[u.layer].grid.findPath(u.point, v.point)
      if (!leg) return null
      out.push(...leg)
    }
    return out
  }

  /**
   * `NavGrid.findDoorRoute` across layers: the first closed door to break on the cheapest route to
   * `to`, walking through flights; `doorId` null = an open route exists; null = none even so.
   */
  findDoorRoute(from: Vec3, to: Vec3): DoorRoute | null {
    if (this.single) return this.ground.findDoorRoute(from, to)
    const nodes = this.planNodes(from, this.locate(from), to, this.locate(to), true)
    const route = this.dijkstra(nodes, true)
    if (!route) return null
    for (let k = 0; k < route.length - 1; k++) {
      const u = nodes[route[k]]
      const v = nodes[route[k + 1]]
      if (u.doorId !== null && u.doorId === v.doorId && u.side !== v.side) return { doorId: u.doorId, approach: { ...u.point }, side: u.side }
    }
    return { doorId: null, approach: { ...to }, side: -1 }
  }

  private placeKey(p: Vec3): string | null {
    const place = this.locate(p)
    if ('stair' in place) {
      const s = this.stairs[place.stair]
      return this.pointKey(s.lower, s.ends[0])
    }
    return this.pointKey(place.layer, p)
  }

  private pointKey(layer: number, p: Vec3): string | null {
    const region = this.layers[layer].grid.componentAt(p.x, p.z)
    return region < 0 ? null : `${layer}:${region}`
  }

  private linkTable(): NonNullable<NavWorld['links']> {
    const version = this.version
    if (this.links?.version === version) return this.links
    const parent = new Map<string, string>()
    for (const s of this.stairs) {
      const a = this.pointKey(s.lower, s.ends[0])
      const b = this.pointKey(s.upper, s.ends[1])
      if (a && b) union(parent, a, b)
    }
    this.links = { version, parent, ids: new Map() }
    return this.links
  }

  /** Start (0), goal (1), both ends of every flight, and with `doors` both sides of every closed door. */
  private planNodes(from: Vec3, a: NavPlace, to: Vec3, b: NavPlace, doors: boolean): PlanNode[] {
    const node = (point: Vec3, place: NavPlace): PlanNode => ('layer' in place
      ? { point, key: this.pointKey(place.layer, point), layer: place.layer, stair: -1, doorId: null, side: -1 }
      : { point, key: null, layer: -1, stair: place.stair, doorId: null, side: -1 })
    const nodes = [node(from, a), node(to, b)]
    this.stairs.forEach((s, i) => {
      nodes.push({ point: s.ends[0], key: this.pointKey(s.lower, s.ends[0]), layer: s.lower, stair: i, doorId: null, side: 0 })
      nodes.push({ point: s.ends[1], key: this.pointKey(s.upper, s.ends[1]), layer: s.upper, stair: i, doorId: null, side: 1 })
    })
    if (doors) {
      for (const [doorId, portal] of this.portals) {
        const layer = this.doorLayer.get(doorId)!
        if (this.layers[layer].grid.doorState(doorId) !== 'closed') continue
        portal.sides.forEach((point, side) => {
          const key = this.layers[layer].grid.isWalkable(point.x, point.z) ? this.pointKey(layer, point) : null
          if (key) nodes.push({ point, key, layer, stair: -1, doorId, side })
        })
      }
    }
    return nodes
  }

  /** Cheapest node sequence from node 0 to node 1 (walks within a region, flights, door breaches). */
  private dijkstra(nodes: PlanNode[], doors: boolean): number[] | null {
    const cost = (i: number, j: number): number => {
      const u = nodes[i]
      const v = nodes[j]
      if (u.stair >= 0 && u.stair === v.stair) {
        // Along one flight: its two ends, or a point on it and either end.
        if (u.key !== null && v.key !== null) return this.stairs[u.stair].length
        return planar(u.point, v.point)
      }
      if (doors && u.doorId !== null && u.doorId === v.doorId && u.side !== v.side) return BREACH_COST
      if (u.key !== null && u.key === v.key) return planar(u.point, v.point)
      return Infinity
    }
    const n = nodes.length
    const dist = new Array<number>(n).fill(Infinity)
    const previous = new Array<number>(n).fill(-1)
    const done = new Array<boolean>(n).fill(false)
    dist[0] = 0
    for (;;) {
      let current = -1
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (current < 0 || dist[i] < dist[current])) current = i
      if (current < 0) return null
      if (current === 1) break
      done[current] = true
      for (let next = 1; next < n; next++) {
        if (done[next]) continue
        const c = cost(current, next)
        if (dist[current] + c < dist[next]) {
          dist[next] = dist[current] + c
          previous[next] = current
        }
      }
    }
    const route: number[] = []
    for (let i = 1; i >= 0; i = previous[i]) route.unshift(i)
    return route
  }
}

function find(parent: Map<string, string>, key: string): string {
  let root = key
  while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!
  let k = key
  while (k !== root) {
    const next = parent.get(k)!
    parent.set(k, root)
    k = next
  }
  return root
}

function union(parent: Map<string, string>, a: string, b: string): void {
  const ra = find(parent, a)
  const rb = find(parent, b)
  if (ra !== rb) parent.set(ra, rb)
}
