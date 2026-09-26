import { GridSearch, heuristic, MinHeap, type CellBounds } from './gridSearch'

/**
 * R3b: the nav grid cut into tiles that match the map chunks (cells whose centre lies in a chunk).
 *
 * Connectivity: each tile labels its own 4-connected regions; regions touching across a tile edge
 * are merged (union-find over the few label pairs per edge). A door change relabels only the tiles
 * it touches instead of flooding the whole grid.
 *
 * Long paths (HPA*): each tile edge has transition points (the middle of a short run of walkable
 * cell pairs, both ends of a long one). Transitions of one tile are joined by their in-tile path
 * cost (computed lazily per tile, cached until that tile or a neighbour changes); transition pairs
 * across an edge cost one step. A query searches this graph, then refines every leg with an A*
 * bounded to one tile. Paths are near-optimal (routes pass through transition cells).
 */

export interface NavTilesSource {
  cols: number
  rows: number
  /** Live walkability (1 = blocked), updated by the grid before it calls `markCellsDirty`. */
  blocked: Uint8Array
  /** World X of a cell column centre / Z of a row centre. */
  cellX(cx: number): number
  cellZ(cz: number): number
}

/** Walkable cell pairs across an edge up to this long get one transition, longer runs two. */
const SHORT_RUN = 5
/** Bound on local A* expansions (a tile has at most tileCells² cells). */
const TILE_SEARCH_LIMIT = 1 << 20

interface Tile {
  bounds: CellBounds
  /** Local region count (labels 0..count-1 in `localLabel`). */
  labels: number
  labelsDirty: boolean
  /** Cells of this tile that are transitions, and their partners across an edge. */
  transitions: Map<number, number[]> | null
  /** In-tile costs from a transition to the others of its region, filled per transition on demand. */
  edges: Map<number, { to: number; cost: number }[]>
}

export class NavTiles {
  readonly tilesX: number
  readonly tilesZ: number
  private readonly src: NavTilesSource
  private readonly search: GridSearch
  private readonly tiles: Tile[]
  private readonly cellTileX: Int32Array
  private readonly cellTileZ: Int32Array
  private readonly localLabel: Int32Array
  private readonly stride: number
  private readonly queue: Int32Array
  /** Region label pairs joined across each tile's east and south edges. */
  private readonly eastPairs: Int32Array[]
  private readonly southPairs: Int32Array[]
  private readonly pairsDirty: Uint8Array
  private parent = new Map<number, number>()
  private unionDirty = true
  private readonly heap = new MinHeap()
  /** Hierarchical searches (instrumentation). */
  hierarchicalSearches = 0

  constructor(src: NavTilesSource, chunkSize: number, search: GridSearch) {
    this.src = src
    this.search = search
    const tileOf = (v: number) => Math.floor(v / chunkSize)
    const tx0 = tileOf(src.cellX(0))
    const tz0 = tileOf(src.cellZ(0))
    this.tilesX = tileOf(src.cellX(src.cols - 1)) - tx0 + 1
    this.tilesZ = tileOf(src.cellZ(src.rows - 1)) - tz0 + 1
    this.cellTileX = new Int32Array(src.cols)
    this.cellTileZ = new Int32Array(src.rows)
    for (let cx = 0; cx < src.cols; cx++) this.cellTileX[cx] = tileOf(src.cellX(cx)) - tx0
    for (let cz = 0; cz < src.rows; cz++) this.cellTileZ[cz] = tileOf(src.cellZ(cz)) - tz0
    this.tiles = []
    let widest = 1
    for (let tz = 0; tz < this.tilesZ; tz++) {
      for (let tx = 0; tx < this.tilesX; tx++) {
        const bounds = { c0: src.cols, c1: -1, r0: src.rows, r1: -1 }
        for (let cx = 0; cx < src.cols; cx++) if (this.cellTileX[cx] === tx) { bounds.c0 = Math.min(bounds.c0, cx); bounds.c1 = Math.max(bounds.c1, cx) }
        for (let cz = 0; cz < src.rows; cz++) if (this.cellTileZ[cz] === tz) { bounds.r0 = Math.min(bounds.r0, cz); bounds.r1 = Math.max(bounds.r1, cz) }
        widest = Math.max(widest, (bounds.c1 - bounds.c0 + 1) * (bounds.r1 - bounds.r0 + 1))
        this.tiles.push({ bounds, labels: 0, labelsDirty: true, transitions: null, edges: new Map() })
      }
    }
    this.stride = widest
    this.localLabel = new Int32Array(src.cols * src.rows).fill(-1)
    this.queue = new Int32Array(widest)
    this.eastPairs = this.tiles.map(() => new Int32Array(0))
    this.southPairs = this.tiles.map(() => new Int32Array(0))
    this.pairsDirty = new Uint8Array(this.tiles.length).fill(1)
  }

  tileOfCell(idx: number): number {
    const cx = idx % this.src.cols
    return this.cellTileZ[(idx - cx) / this.src.cols] * this.tilesX + this.cellTileX[cx]
  }

  /** Chebyshev distance in tiles between two cells. */
  tileDistance(a: number, b: number): number {
    const ta = this.tileOfCell(a)
    const tb = this.tileOfCell(b)
    return Math.max(Math.abs((ta % this.tilesX) - (tb % this.tilesX)), Math.abs(Math.floor(ta / this.tilesX) - Math.floor(tb / this.tilesX)))
  }

  /**
   * Walkability of these cells changed (door). Their tiles relabel and lose their in-tile edges; a
   * neighbour loses its transitions/edges only when a changed cell lies on the edge they share.
   */
  markCellsDirty(cells: Iterable<number>): void {
    const cols = this.src.cols
    for (const idx of cells) {
      const t = this.tileOfCell(idx)
      this.markTileDirty(t, false)
      const b = this.tiles[t].bounds
      const cx = idx % cols
      const cz = (idx - cx) / cols
      const tx = t % this.tilesX
      const tz = (t - tx) / this.tilesX
      if (cx === b.c0 && tx > 0) this.dropEdgeNeighbour(t - 1)
      if (cx === b.c1 && tx + 1 < this.tilesX) this.dropEdgeNeighbour(t + 1)
      if (cz === b.r0 && tz > 0) this.dropEdgeNeighbour(t - this.tilesX)
      if (cz === b.r1 && tz + 1 < this.tilesZ) this.dropEdgeNeighbour(t + this.tilesX)
      if (cx === b.c0 || cx === b.c1 || cz === b.r0 || cz === b.r1) this.tiles[t].transitions = null
    }
  }

  markAllDirty(): void {
    for (let t = 0; t < this.tiles.length; t++) this.markTileDirty(t, true)
  }

  private markTileDirty(t: number, transitions: boolean): void {
    const tile = this.tiles[t]
    tile.labelsDirty = true
    const tx = t % this.tilesX
    const tz = (t - tx) / this.tilesX
    // Relabelling renumbers this tile's regions: every pair list touching it is stale.
    this.pairsDirty[t] = 1
    if (tx > 0) this.pairsDirty[t - 1] = 1
    if (tz > 0) this.pairsDirty[t - this.tilesX] = 1
    if (transitions) tile.transitions = null
    this.dropGraph(t)
    this.unionDirty = true
  }

  /** A neighbour across an edge whose cells changed: its transitions on that edge moved too. */
  private dropEdgeNeighbour(t: number): void {
    this.tiles[t].transitions = null
    this.dropGraph(t)
  }

  /** Forget a tile's in-tile edges (recomputed on demand / by `warm`, dirty tiles first). */
  private dropGraph(t: number): void {
    this.tiles[t].edges.clear()
    this.warmQueue.add(t)
    this.warmComplete = false
  }

  /** Connected region of a walkable cell (equal ⇔ an A* without corner cutting can go between them). */
  regionOf(idx: number): number {
    this.ensureRegions()
    const label = this.localLabel[idx]
    if (label < 0) return -1
    return this.find(this.tileOfCell(idx) * this.stride + label)
  }

  private ensureRegions(): void {
    if (!this.unionDirty) return
    for (let t = 0; t < this.tiles.length; t++) if (this.tiles[t].labelsDirty) this.labelTile(t)
    for (let t = 0; t < this.tiles.length; t++) if (this.pairsDirty[t]) this.edgePairs(t)
    this.parent = new Map()
    for (let t = 0; t < this.tiles.length; t++) {
      const east = this.eastPairs[t]
      for (let i = 0; i < east.length; i += 2) this.union(t * this.stride + east[i], (t + 1) * this.stride + east[i + 1])
      const south = this.southPairs[t]
      for (let i = 0; i < south.length; i += 2) this.union(t * this.stride + south[i], (t + this.tilesX) * this.stride + south[i + 1])
    }
    this.unionDirty = false
  }

  private labelTile(t: number): void {
    const tile = this.tiles[t]
    const { c0, c1, r0, r1 } = tile.bounds
    const cols = this.src.cols
    const blocked = this.src.blocked
    const labels = this.localLabel
    for (let cz = r0; cz <= r1; cz++) labels.fill(-1, cz * cols + c0, cz * cols + c1 + 1)
    let next = 0
    const q = this.queue
    for (let cz = r0; cz <= r1; cz++) {
      for (let cx = c0; cx <= c1; cx++) {
        const seed = cz * cols + cx
        if (blocked[seed] || labels[seed] >= 0) continue
        let head = 0
        let tail = 0
        q[tail++] = seed
        labels[seed] = next
        while (head < tail) {
          const idx = q[head++]
          const x = idx % cols
          const z = (idx - x) / cols
          for (const n of [x > c0 ? idx - 1 : -1, x < c1 ? idx + 1 : -1, z > r0 ? idx - cols : -1, z < r1 ? idx + cols : -1]) {
            if (n < 0 || blocked[n] || labels[n] >= 0) continue
            labels[n] = next
            q[tail++] = n
          }
        }
        next += 1
      }
    }
    tile.labels = next
    tile.labelsDirty = false
  }

  /** Label pairs joined across tile `t`'s east and south edges (deduplicated). */
  private edgePairs(t: number): void {
    const tx = t % this.tilesX
    const tz = (t - tx) / this.tilesX
    const cols = this.src.cols
    const blocked = this.src.blocked
    const b = this.tiles[t].bounds
    const collect = (pairs: (a: number, n: number) => void, across: (i: number) => [number, number], count: number) => {
      for (let i = 0; i < count; i++) {
        const [a, n] = across(i)
        if (!blocked[a] && !blocked[n]) pairs(a, n)
      }
    }
    const make = (fill: (push: (a: number, n: number) => void) => void) => {
      const seen = new Set<number>()
      const out: number[] = []
      fill((a, n) => {
        const la = this.localLabel[a]
        const ln = this.localLabel[n]
        const key = la * this.stride + ln
        if (seen.has(key)) return
        seen.add(key)
        out.push(la, ln)
      })
      return Int32Array.from(out)
    }
    this.eastPairs[t] = tx + 1 < this.tilesX
      ? make((push) => collect(push, (i) => [(b.r0 + i) * cols + b.c1, (b.r0 + i) * cols + b.c1 + 1], b.r1 - b.r0 + 1))
      : new Int32Array(0)
    this.southPairs[t] = tz + 1 < this.tilesZ
      ? make((push) => collect(push, (i) => [b.r1 * cols + b.c0 + i, (b.r1 + 1) * cols + b.c0 + i], b.c1 - b.c0 + 1))
      : new Int32Array(0)
    this.pairsDirty[t] = 0
  }

  private find(x: number): number {
    let root = x
    for (;;) {
      const p = this.parent.get(root)
      if (p === undefined || p === root) break
      root = p
    }
    let cur = x
    while (cur !== root) {
      const p = this.parent.get(cur)!
      this.parent.set(cur, root)
      cur = p
    }
    return root
  }

  private union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    // Smaller id becomes the root: deterministic whatever the pair order.
    if (ra < rb) this.parent.set(rb, ra)
    else this.parent.set(ra, rb)
  }

  // ---- Hierarchical path search ----

  /** Transitions of a tile: cell → partner cells across edges (computed on demand). */
  private transitionsOf(t: number): Map<number, number[]> {
    const tile = this.tiles[t]
    if (tile.transitions) return tile.transitions
    const out = new Map<number, number[]>()
    const tx = t % this.tilesX
    const tz = (t - tx) / this.tilesX
    const cols = this.src.cols
    const blocked = this.src.blocked
    const b = tile.bounds
    const add = (a: number, n: number) => {
      const list = out.get(a)
      if (list) list.push(n)
      else out.set(a, [n])
    }
    /** Runs of walkable pairs along one edge; `pair(i)` gives [inside, outside] cells. */
    const edge = (count: number, pair: (i: number) => [number, number]) => {
      let start = -1
      for (let i = 0; i <= count; i++) {
        const open = i < count && (() => { const [a, n] = pair(i); return !blocked[a] && !blocked[n] })()
        if (open && start < 0) start = i
        if (!open && start >= 0) {
          const end = i - 1
          if (end - start + 1 <= SHORT_RUN) {
            const [a, n] = pair((start + end) >> 1)
            add(a, n)
          } else {
            for (const k of [start, end]) {
              const [a, n] = pair(k)
              add(a, n)
            }
          }
          start = -1
        }
      }
    }
    const h = b.r1 - b.r0 + 1
    const w = b.c1 - b.c0 + 1
    if (tx + 1 < this.tilesX) edge(h, (i) => [(b.r0 + i) * cols + b.c1, (b.r0 + i) * cols + b.c1 + 1])
    if (tx > 0) edge(h, (i) => [(b.r0 + i) * cols + b.c0, (b.r0 + i) * cols + b.c0 - 1])
    if (tz + 1 < this.tilesZ) edge(w, (i) => [b.r1 * cols + b.c0 + i, (b.r1 + 1) * cols + b.c0 + i])
    if (tz > 0) edge(w, (i) => [b.r0 * cols + b.c0 + i, (b.r0 - 1) * cols + b.c0 + i])
    tile.transitions = out
    return out
  }

  /**
   * In-tile costs from one transition to the other transitions of its region: one bounded Dijkstra,
   * run the first time the search expands that transition (or ahead of time by `warm`), cached
   * until the tile or a neighbour changes.
   */
  private edgesFrom(t: number, cell: number): { to: number; cost: number }[] {
    const tile = this.tiles[t]
    const cached = tile.edges.get(cell)
    if (cached) return cached
    this.ensureRegions()
    const label = this.localLabel[cell]
    const same = [...this.transitionsOf(t).keys()].filter((c) => c !== cell && this.localLabel[c] === label)
    const list: { to: number; cost: number }[] = []
    if (same.length) for (const [to, cost] of this.search.distances(cell, same, tile.bounds)) list.push({ to, cost })
    tile.edges.set(cell, list)
    return list
  }

  /**
   * Precompute missing transition edges for up to `budgetMs` (idle time after the path queue), so
   * long routes rarely pay for them. Only changes when work is done, never the result.
   */
  warm(budgetMs: number): number {
    if (this.warmComplete) return 0
    this.ensureRegions()
    const t0 = performance.now()
    let done = 0
    // Tiles whose graph was dropped (door changes) first, in the order they changed.
    for (const t of this.warmQueue) {
      const tile = this.tiles[t]
      for (const cell of this.transitionsOf(t).keys()) {
        if (tile.edges.has(cell)) continue
        this.edgesFrom(t, cell)
        done++
        if (performance.now() - t0 >= budgetMs) return done
      }
      this.warmQueue.delete(t)
    }
    this.warmComplete = true
    return done
  }
  /** Every transition of every tile has its in-tile edges (nothing left for `warm`). */
  get warmed(): boolean {
    return this.warmComplete
  }

  /** Tiles still waiting for `warm`. */
  get pendingWarm(): number {
    return this.warmComplete ? 0 : this.warmQueue.size
  }

  /** Tiles still waiting for `warm`, in the order they will warm (tests). */
  pendingWarmTiles(): number[] {
    return this.warmComplete ? [] : [...this.warmQueue]
  }

  /** Warm the tiles nearest this cell's tile first (Chebyshev distance, then tile order). */
  prioritize(cell: number): void {
    const t0 = this.tileOfCell(cell)
    const x0 = t0 % this.tilesX
    const z0 = Math.floor(t0 / this.tilesX)
    const distance = (t: number) => Math.max(Math.abs((t % this.tilesX) - x0), Math.abs(Math.floor(t / this.tilesX) - z0))
    const order = [...this.warmQueue].sort((a, b) => distance(a) - distance(b) || a - b)
    this.warmQueue.clear()
    for (const t of order) this.warmQueue.add(t)
  }

  /** Tiles that may miss in-tile edges. */
  private readonly warmQueue = new Set<number>()
  /** Every transition has its edges (reset when a tile changes). */
  private warmComplete = false

  /**
   * Cells of a path from `start` to `goal` (both walkable, same region) through the transition
   * graph, refined tile by tile; null when the graph finds no route.
   */
  findCells(start: number, goal: number): number[] | null {
    this.ensureRegions()
    this.hierarchicalSearches += 1
    const cols = this.src.cols
    const st = this.tileOfCell(start)
    const gt = this.tileOfCell(goal)
    const gx = goal % cols
    const gz = (goal - gx) / cols
    const h = (idx: number) => {
      const x = idx % cols
      return heuristic(x, (idx - x) / cols, gx, gz)
    }
    const startTrans = [...this.transitionsOf(st).keys()].filter((c) => this.localLabel[c] === this.localLabel[start])
    const goalTrans = [...this.transitionsOf(gt).keys()].filter((c) => this.localLabel[c] === this.localLabel[goal])
    const fromStart = this.search.distances(start, startTrans, this.tiles[st].bounds)
    const toGoal = this.search.distances(goal, goalTrans, this.tiles[gt].bounds)
    if (fromStart.size === 0 || toGoal.size === 0) return null

    // Abstract A*: nodes are transition cells; GOAL is a virtual node reached from goal-tile transitions.
    const GOAL = -1
    const g = new Map<number, number>()
    const prev = new Map<number, number>()
    const closed = new Set<number>()
    const open = this.heap
    open.clear()
    for (const [cell, cost] of fromStart) {
      g.set(cell, cost)
      prev.set(cell, start)
      open.push(cell, cost + h(cell))
    }
    let reached = false
    while (open.size > 0) {
      const cur = open.pop()
      if (cur === GOAL) {
        reached = true
        break
      }
      if (closed.has(cur)) continue
      closed.add(cur)
      const base = g.get(cur)!
      const relax = (to: number, cost: number) => {
        const next = base + cost
        const known = g.get(to)
        if (known !== undefined && known <= next) return
        g.set(to, next)
        prev.set(to, cur)
        open.push(to, to === GOAL ? next : next + h(to))
      }
      const t = this.tileOfCell(cur)
      if (t === gt) {
        const last = toGoal.get(cur)
        if (last !== undefined) relax(GOAL, last)
      }
      for (const e of this.edgesFrom(t, cur)) relax(e.to, e.cost)
      // Partners across an edge are orthogonal neighbours: one step.
      for (const n of this.transitionsOf(t).get(cur) ?? []) relax(n, 1)
    }
    if (!reached) return null

    // Waypoints: start → transitions … → goal, then refine each leg inside its tile.
    const nodes: number[] = [goal]
    for (let cur = prev.get(GOAL)!; cur !== start; cur = prev.get(cur)!) nodes.push(cur)
    nodes.push(start)
    nodes.reverse()
    const cells: number[] = [start]
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1]
      const b = nodes[i]
      const ta = this.tileOfCell(a)
      if (ta !== this.tileOfCell(b)) {
        cells.push(b) // step across a tile edge
        continue
      }
      const leg = this.search.astar(a, b, this.tiles[ta].bounds, TILE_SEARCH_LIMIT)
      if (!leg) return null
      for (let k = 1; k < leg.length; k++) cells.push(leg[k])
    }
    return cells
  }
}
