import type { Vec3 } from '../../types'
import { mapChunkSize, mapWindows, type MapData } from './mapData'
import type { DoorPlacement } from './buildings'
import { DOOR_LEAF_THICKNESS, type DoorStatus } from './doors'
import { GridSearch, type CellBounds } from './gridSearch'
import { NavTiles } from './navTiles'

export interface NavGridOptions {
  cellSize: number
  agentRadius: number
}

/** Vật cản có đáy cao hơn ngưỡng này (dầm trên cửa) thì không chặn đường đi. */
const OVERHEAD_MIN_BOTTOM = 1.6
/** Giới hạn số ô A* mở rộng để một truy vấn không bao giờ làm khựng frame. */
const MAX_EXPANSIONS = 20000
/** Hierarchical paths look this many waypoints ahead when straightening (bounded cost on long routes). */
const SMOOTH_WINDOW = 48
/** Planning cost (metres) of breaking through a closed door, versus walking around (plan §10.2). */
const BREACH_COST = 12
/** Bash slots sit this far either side of the door centre, along the wall. */
const SLOT_SPREAD = 0.35

export interface DoorPortal {
  /** Door centre on the ground. */
  center: Vec3
  /** Approach point on each side, outside the door corridor cells. */
  sides: [Vec3, Vec3]
  /** Up to two contact positions per side for zombies bashing the door. */
  slots: [Vec3[], Vec3[]]
}

/** First door to break on the way to a target; `doorId` null = there is an open route. */
export interface DoorRoute {
  doorId: string | null
  /** Approach point on the caller's side of that door (the target itself when open). */
  approach: Vec3
  /** Portal side index of `approach`; -1 when the route is open. */
  side: number
}

interface DoorCells {
  /** Ô trong khung cửa: đi được khi cửa mở, chặn khi đóng. */
  corridor: number[]
  /** Ô bị cánh cửa mở chiếm: chặn khi cửa mở. */
  openLeaf: number[]
}

/**
 * Lưới điều hướng dựng trước từ map data: ô bị chặn bởi tường/vật cản đã nới
 * rộng theo bán kính tác nhân; ô trong khung cửa đi được tùy trạng thái cửa.
 * Simulation dùng `findPath` (A* 8 hướng, không cắt góc) và `hasLineOfWalk`
 * để zombie đi vòng tường, qua cửa mở mà không cần physics.
 *
 * R3b: the grid is also cut into chunk tiles (`NavTiles`): connected regions are labelled per tile
 * and merged across tile edges (a door change relabels its tiles only), and a route between tiles
 * two or more apart runs on the tile transition graph (HPA*) instead of one A* over the whole map.
 * Routes within neighbouring tiles use the plain A* exactly as before.
 */
export class NavGrid {
  readonly cellSize: number
  readonly cols: number
  readonly rows: number
  /** Góc min của lưới trong tọa độ thế giới. */
  readonly originX: number
  readonly originZ: number
  /** Tăng mỗi khi trạng thái cửa đổi; zombie so sánh để biết path đã cũ. */
  version = 0

  private readonly staticBlocked: Uint8Array
  private readonly blocked: Uint8Array
  private readonly doorCells = new Map<string, DoorCells>()
  private readonly doorStates = new Map<string, DoorStatus>()
  /** New-game state per door (interior doors may start open). */
  private readonly initialDoorStates = new Map<string, DoorStatus>()
  private readonly cellDoors = new Map<number, Set<string>>()
  readonly portals = new Map<string, DoorPortal>()
  /** R1: A* with working buffers allocated once per grid (stamped, never cleared). */
  private readonly search: GridSearch
  /** R3b: chunk tiles (regions per tile, transition graph for long routes). */
  readonly tiles: NavTiles
  private readonly whole: CellBounds

  constructor(map: MapData, opts: NavGridOptions) {
    this.cellSize = opts.cellSize
    const extent = map.size + 2
    this.cols = Math.ceil(extent / opts.cellSize)
    this.rows = this.cols
    this.originX = -map.size / 2 - 1
    this.originZ = -map.size / 2 - 1
    this.staticBlocked = new Uint8Array(this.cols * this.rows)
    this.blocked = new Uint8Array(this.cols * this.rows)
    this.search = new GridSearch(this.cols, this.rows, this.blocked)
    this.whole = { c0: 0, c1: this.cols - 1, r0: 0, r1: this.rows - 1 }
    this.tiles = new NavTiles({
      cols: this.cols,
      rows: this.rows,
      blocked: this.blocked,
      cellX: (cx) => this.originX + (cx + 0.5) * this.cellSize,
      cellZ: (cz) => this.originZ + (cz + 0.5) * this.cellSize,
    }, mapChunkSize(map), this.search)

    const r = opts.agentRadius
    for (const wall of map.walls) {
      const bottom = wall.position.y - wall.size[1] / 2
      if (bottom >= OVERHEAD_MIN_BOTTOM) continue
      this.fillRect(
        this.staticBlocked,
        wall.position.x - wall.size[0] / 2 - r,
        wall.position.z - wall.size[2] / 2 - r,
        wall.position.x + wall.size[0] / 2 + r,
        wall.position.z + wall.size[2] / 2 + r,
        1,
      )
    }

    // Window panes block like the wall they replace (sill below, header above is overhead).
    for (const win of mapWindows(map)) {
      const hx = (win.alongX ? win.width : win.thickness) / 2 + r
      const hz = (win.alongX ? win.thickness : win.width) / 2 + r
      this.fillRect(this.staticBlocked, win.center.x - hx, win.center.z - hz, win.center.x + hx, win.center.z + hz, 1)
    }

    for (const door of map.doors) {
      const building = map.buildings.find((b) => b.id === door.buildingId)
      const thickness = building?.wallThickness ?? 0.3
      const corridor = this.doorCorridorCells(door, thickness, r)
      for (const idx of corridor) this.staticBlocked[idx] = 0
      const openLeaf = this.doorLeafCells(door, door.openAngle, r).filter((idx) => !corridor.includes(idx))
      this.doorCells.set(door.id, { corridor, openLeaf })
      this.doorStates.set(door.id, door.initialState ?? 'closed')
      this.initialDoorStates.set(door.id, door.initialState ?? 'closed')
      for (const idx of [...corridor, ...openLeaf]) {
        const owners = this.cellDoors.get(idx) ?? new Set<string>()
        owners.add(door.id)
        this.cellDoors.set(idx, owners)
      }
      const alongX = door.hinge.x !== door.center.x
      const offset = thickness / 2 + r + this.cellSize
      const sides = [-1, 1].map((sign) => ({
        x: door.center.x + (alongX ? 0 : sign * offset), y: 0,
        z: door.center.z + (alongX ? sign * offset : 0),
      })) as [Vec3, Vec3]
      const slots = sides.map((side) => [-1, 1].map((sign) => ({
        x: side.x + (alongX ? sign * SLOT_SPREAD : 0), y: 0,
        z: side.z + (alongX ? 0 : sign * SLOT_SPREAD),
      }))) as [Vec3[], Vec3[]]
      this.portals.set(door.id, { center: { x: door.center.x, y: 0, z: door.center.z }, sides, slots })
    }
    this.rebuild()
    // R3b: build the tile graph now (like loading a chunk) so the first long route is not the one to pay.
    this.tiles.warm(Infinity)
    // Slots that fall on blocked cells (furniture, walls) use the side point instead.
    for (const portal of this.portals.values()) {
      portal.slots = portal.slots.map((list, i) => list.map((p) => (this.staticWalkable(p) ? p : { ...portal.sides[i] }))) as [Vec3[], Vec3[]]
    }
  }

  setDoorOpen(id: string, open: boolean): void {
    this.setDoorState(id, open ? 'open' : 'closed')
  }

  setDoorState(id: string, state: DoorStatus): void {
    const cells = this.doorCells.get(id)
    if (!cells || this.doorStates.get(id) === state) return
    this.doorStates.set(id, state)
    const changed = new Set([...cells.corridor, ...cells.openLeaf])
    for (const idx of changed) this.refreshCell(idx)
    this.tiles.markCellsDirty(changed)
    this.version += 1
  }

  /** New game: every door back to its initial state (only the doors that changed touch the tiles). */
  resetDoors(): void {
    const changed = new Set<number>()
    for (const [id, state] of this.doorStates) {
      const initial = this.initialDoorStates.get(id) ?? 'closed'
      if (state === initial) continue
      this.doorStates.set(id, initial)
      const cells = this.doorCells.get(id)!
      for (const idx of [...cells.corridor, ...cells.openLeaf]) changed.add(idx)
    }
    for (const idx of changed) this.refreshCell(idx)
    if (changed.size) this.tiles.markCellsDirty(changed)
    this.version += 1
  }

  worldToCell(x: number, z: number): { cx: number; cz: number } {
    return {
      cx: Math.floor((x - this.originX) / this.cellSize),
      cz: Math.floor((z - this.originZ) / this.cellSize),
    }
  }

  cellToWorld(cx: number, cz: number): Vec3 {
    return { x: this.originX + (cx + 0.5) * this.cellSize, y: 0, z: this.originZ + (cz + 0.5) * this.cellSize }
  }

  isWalkableCell(cx: number, cz: number): boolean {
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return false
    return this.blocked[cz * this.cols + cx] === 0
  }

  isWalkable(x: number, z: number): boolean {
    const c = this.worldToCell(x, z)
    return this.isWalkableCell(c.cx, c.cz)
  }

  /** Đoạn thẳng a→b không đi qua ô bị chặn (ô đã nới theo bán kính tác nhân). */
  hasLineOfWalk(a: Vec3, b: Vec3): boolean {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    const steps = Math.max(1, Math.ceil(len / (this.cellSize * 0.5)))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      if (!this.isWalkable(a.x + dx * t, a.z + dz * t)) return false
    }
    return true
  }

  /** Ô đi được gần nhất trong bán kính vài ô; null nếu không có. */
  nearestWalkableCell(x: number, z: number, maxRadius = 4): { cx: number; cz: number } | null {
    const c = this.worldToCell(x, z)
    if (this.isWalkableCell(c.cx, c.cz)) return c
    for (let ring = 1; ring <= maxRadius; ring++) {
      let best: { cx: number; cz: number; d: number } | null = null
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue
          const cx = c.cx + dx
          const cz = c.cz + dz
          if (!this.isWalkableCell(cx, cz)) continue
          const w = this.cellToWorld(cx, cz)
          const d = Math.hypot(w.x - x, w.z - z)
          if (!best || d < best.d) best = { cx, cz, d }
        }
      }
      if (best) return { cx: best.cx, cz: best.cz }
    }
    return null
  }

  /** A* searches run (instrumentation): cell-level searches, including the tile legs of long routes. */
  get searches(): number {
    return this.search.searches
  }

  /**
   * Connected region (4-neighbour, which is exactly what A* without corner cutting can reach) of
   * the walkable cell nearest to a point; -1 when there is none. R3b: regions come from the chunk
   * tiles (per-tile labels merged across edges), so "is there any route" stays a lookup and a door
   * change only relabels its tiles. Region IDs are only comparable within one nav `version`.
   */
  componentAt(x: number, z: number): number {
    const c = this.nearestWalkableCell(x, z)
    return c ? this.tiles.regionOf(c.cz * this.cols + c.cx) : -1
  }

  private staticWalkable(p: Vec3): boolean {
    const c = this.worldToCell(p.x, p.z)
    return c.cx >= 0 && c.cz >= 0 && c.cx < this.cols && c.cz < this.rows && this.staticBlocked[c.cz * this.cols + c.cx] === 0
  }

  /**
   * Tìm đường từ `from` tới `to`. Trả về danh sách waypoint (không gồm điểm
   * xuất phát, điểm cuối là `to` nếu ô đích đi được), đã làm thẳng bằng kiểm
   * tra tầm đi. null nếu không có đường (khác vùng liên thông: trả ngay, không chạy A*).
   */
  findPath(from: Vec3, to: Vec3): Vec3[] | null {
    const start = this.nearestWalkableCell(from.x, from.z)
    const goal = this.nearestWalkableCell(to.x, to.z)
    if (!start || !goal) return null
    if (start.cx === goal.cx && start.cz === goal.cz) return [this.goalPoint(to, goal)]
    const startIdx = start.cz * this.cols + start.cx
    const goalIdx = goal.cz * this.cols + goal.cx
    if (this.tiles.regionOf(startIdx) !== this.tiles.regionOf(goalIdx)) return null

    // Nearby: one A* as before. Far (or a nearby search that ran out of budget): the tile graph.
    const near = this.tiles.tileDistance(startIdx, goalIdx) <= 1
    let cells = near ? this.search.astar(startIdx, goalIdx, this.whole, MAX_EXPANSIONS) : null
    const hierarchical = !cells
    cells ??= this.tiles.findCells(startIdx, goalIdx)
    if (!cells) return null

    const points: Vec3[] = [{ x: from.x, y: 0, z: from.z }]
    for (let i = 1; i < cells.length; i++) {
      const cx = cells[i] % this.cols
      points.push(this.cellToWorld(cx, (cells[i] - cx) / this.cols))
    }
    points[points.length - 1] = this.goalPoint(to, goal)
    return this.smooth(points, hierarchical ? SMOOTH_WINDOW : Infinity)
  }

  /**
   * R2 pre-check of a path request, without A*: 'none' = no route (no walkable cell nearby or another
   * connected region; `findPath` would return null), 'direct' = start and goal share a cell (the path
   * is one waypoint), 'search' = an A* search is needed (queued).
   */
  routeKind(from: Vec3, to: Vec3): 'none' | 'direct' | 'search' {
    const start = this.nearestWalkableCell(from.x, from.z)
    const goal = this.nearestWalkableCell(to.x, to.z)
    if (!start || !goal) return 'none'
    if (start.cx === goal.cx && start.cz === goal.cz) return 'direct'
    return this.tiles.regionOf(start.cz * this.cols + start.cx) === this.tiles.regionOf(goal.cz * this.cols + goal.cx) ? 'search' : 'none'
  }

  private goalPoint(to: Vec3, goal: { cx: number; cz: number }): Vec3 {
    return this.isWalkable(to.x, to.z) ? { x: to.x, y: 0, z: to.z } : this.cellToWorld(goal.cx, goal.cz)
  }

  /** Kéo thẳng đường: từ mỗi điểm nhảy tới điểm xa nhất còn nhìn thấy trên lưới (trong `window` điểm tới). */
  private smooth(points: Vec3[], window: number): Vec3[] {
    const out: Vec3[] = []
    let i = 0
    while (i < points.length - 1) {
      let j = Math.min(points.length - 1, i + window)
      while (j > i + 1 && !this.hasLineOfWalk(points[i], points[j])) j--
      out.push(points[j])
      i = j
    }
    return out
  }

  private rebuild(): void {
    this.blocked.set(this.staticBlocked)
    for (const idx of this.cellDoors.keys()) this.refreshCell(idx)
    this.tiles.markAllDirty()
    this.version += 1
  }

  private refreshCell(idx: number): void {
    let blocked = this.staticBlocked[idx]
    for (const id of this.cellDoors.get(idx) ?? []) {
      const cells = this.doorCells.get(id)!
      const state = this.doorStates.get(id)
      if (state === 'closed' && cells.corridor.includes(idx) || state === 'open' && cells.openLeaf.includes(idx)) blocked = 1
    }
    this.blocked[idx] = blocked
  }

  /**
   * Planning only (plan §10.2), never opens live cells: which closed door to break to reach `to`.
   * Nodes are the start, both approach points of every closed door and the goal; walking edges join
   * nodes of the same connected region (straight-line length as the estimate), breach edges join
   * the two sides of one closed door at `BREACH_COST`. Returns the first door on the cheapest
   * route, so a door that does not lead towards the target is never chosen; an open alternative
   * route wins outright. null when even breaking doors cannot reach the target. Cheap: the region
   * labels are cached per nav revision and the graph has 2 nodes per closed door.
   */
  findDoorRoute(from: Vec3, to: Vec3): DoorRoute | null {
    const startRegion = this.componentAt(from.x, from.z)
    const goalRegion = this.componentAt(to.x, to.z)
    if (startRegion < 0 || goalRegion < 0) return null
    if (startRegion === goalRegion) return { doorId: null, approach: { ...to }, side: -1 }
    const nodes: { point: Vec3; region: number; doorId: string | null; side: number }[] = [
      { point: from, region: startRegion, doorId: null, side: -1 },
      { point: to, region: goalRegion, doorId: null, side: -1 },
    ]
    for (const [doorId, portal] of this.portals) {
      if (this.doorStates.get(doorId) !== 'closed') continue
      portal.sides.forEach((point, side) => {
        const region = this.isWalkable(point.x, point.z) ? this.componentAt(point.x, point.z) : -1
        if (region >= 0) nodes.push({ point, region, doorId, side })
      })
    }
    const dist = nodes.map(() => Infinity)
    const previous = nodes.map(() => -1)
    const done = nodes.map(() => false)
    dist[0] = 0
    for (;;) {
      let current = -1
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < Infinity && (current < 0 || dist[i] < dist[current])) current = i
      if (current < 0) return null
      if (current === 1) break
      done[current] = true
      const a = nodes[current]
      for (let next = 1; next < nodes.length; next++) {
        if (done[next]) continue
        const b = nodes[next]
        const breach = a.doorId !== null && a.doorId === b.doorId && a.side !== b.side
        if (!breach && a.region !== b.region) continue
        const cost = breach ? BREACH_COST : Math.hypot(a.point.x - b.point.x, a.point.z - b.point.z)
        if (dist[current] + cost < dist[next]) {
          dist[next] = dist[current] + cost
          previous[next] = current
        }
      }
    }
    const route: number[] = []
    for (let i = 1; i >= 0; i = previous[i]) route.unshift(i)
    for (let i = 0; i < route.length - 1; i++) {
      const a = nodes[route[i]]
      const b = nodes[route[i + 1]]
      if (a.doorId !== null && a.doorId === b.doorId && a.side !== b.side) return { doorId: a.doorId, approach: { ...a.point }, side: a.side }
    }
    return null
  }

  doorState(id: string): DoorStatus | undefined {
    return this.doorStates.get(id)
  }

  private fillRect(target: Uint8Array, minX: number, minZ: number, maxX: number, maxZ: number, value: number): void {
    const c0 = this.worldToCell(minX, minZ)
    const c1 = this.worldToCell(maxX, maxZ)
    for (let cz = Math.max(0, c0.cz); cz <= Math.min(this.rows - 1, c1.cz); cz++) {
      for (let cx = Math.max(0, c0.cx); cx <= Math.min(this.cols - 1, c1.cx); cx++) {
        const w = this.cellToWorld(cx, cz)
        if (w.x >= minX && w.x <= maxX && w.z >= minZ && w.z <= maxZ) target[cz * this.cols + cx] = value
      }
    }
  }

  private cellsInRect(minX: number, minZ: number, maxX: number, maxZ: number): number[] {
    const out: number[] = []
    const c0 = this.worldToCell(minX, minZ)
    const c1 = this.worldToCell(maxX, maxZ)
    for (let cz = Math.max(0, c0.cz); cz <= Math.min(this.rows - 1, c1.cz); cz++) {
      for (let cx = Math.max(0, c0.cx); cx <= Math.min(this.cols - 1, c1.cx); cx++) {
        const w = this.cellToWorld(cx, cz)
        if (w.x >= minX && w.x <= maxX && w.z >= minZ && w.z <= maxZ) out.push(cz * this.cols + cx)
      }
    }
    return out
  }

  /** Ô trong khung cửa: hẹp theo mặt tường (chừa bán kính tác nhân), dài xuyên qua tường. */
  private doorCorridorCells(door: DoorPlacement, wallThickness: number, r: number): number[] {
    const alongX = door.hinge.x !== door.center.x
    const halfAlong = Math.max(door.width / 2 - r, this.cellSize * 0.55)
    const halfAcross = wallThickness / 2 + r + this.cellSize * 0.25
    return alongX
      ? this.cellsInRect(door.center.x - halfAlong, door.center.z - halfAcross, door.center.x + halfAlong, door.center.z + halfAcross)
      : this.cellsInRect(door.center.x - halfAcross, door.center.z - halfAlong, door.center.x + halfAcross, door.center.z + halfAlong)
  }

  /** Ô nằm trong vùng cánh cửa (đoạn thẳng từ bản lề, quay theo `angle`) nới theo bán kính. */
  private doorLeafCells(door: DoorPlacement, angle: number, r: number): number[] {
    const dirX = Math.cos(angle)
    const dirZ = -Math.sin(angle)
    const ax = door.hinge.x
    const az = door.hinge.z
    const bx = ax + dirX * door.width
    const bz = az + dirZ * door.width
    const pad = DOOR_LEAF_THICKNESS / 2 + r
    const cells = this.cellsInRect(Math.min(ax, bx) - pad, Math.min(az, bz) - pad, Math.max(ax, bx) + pad, Math.max(az, bz) + pad)
    return cells.filter((idx) => {
      const cx = idx % this.cols
      const w = this.cellToWorld(cx, (idx - cx) / this.cols)
      return distanceToSegment(w.x, w.z, ax, az, bx, bz) <= pad
    })
  }
}

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax
  const vz = bz - az
  const len2 = vx * vx + vz * vz
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / len2)) : 0
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t))
}
